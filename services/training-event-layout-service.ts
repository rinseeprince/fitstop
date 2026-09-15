import { supabaseAdmin } from "./supabase-admin";
import { getClientWeekAnchor } from "./check-in-week-service";
import {
  DateOccupiedError,
  occupiedMessage,
  rethrowIfAnyDateOccupied,
} from "./training-event-occupancy";
import { getTrainingWeekEnd, getTrainingWeekStart } from "@/lib/date-helpers";
import { getLogWindow } from "./daily-log-permissions-service";

// =============================================================================
// Client week layout — the client's side of "a session changes date".
//
// A single move, a two-day swap and a whole-week rearrangement are the same
// operation at different sizes: a list of {event, from, to} applied in one
// transaction by `move_training_events_atomic` (migration 150). That function
// is the ONE write path for a change of date: the client's layout here and the
// coach's calendar drag (`moveEvent`, training-event-calendar-service.ts) both
// go through it, and each side keeps its own rules. This service owns the
// POLICY a client's own calendar imposes, the calendar service owns the
// coach's; `readMoveRpcError` reads the function's message contract once, and
// each side answers it with its own typed errors and sentences.
// =============================================================================

type LayoutMove = { eventId: string; fromDate: string; toDate: string };
type AppliedLayout = { moved: LayoutMove[] };

/** The client's view of their week is stale — reload before trying again. Routes answer 409. */
export class LayoutDriftError extends Error {}
/** A rule the client's own calendar imposes (week bound, past day, logged session). Routes answer 400. */
export class LayoutPolicyError extends Error {}
/** An event that does not exist for this client. Routes answer 404 (no existence oracle). */
export class LayoutNotFoundError extends Error {}

export const LAYOUT_DRIFT_MESSAGE = "Your week changed since you opened it — reload and try again";

/**
 * Apply a layout to the client's own calendar.
 *
 * Policy, checked here before the RPC (each rule names the sentence the client sees):
 *  - only a still-`scheduled` session moves — a logged day is pinned;
 *  - a session moves only within the training week it CURRENTLY sits in
 *    (check-in-anchored — the same seven days adherence counts), so a missed
 *    session cannot be pushed forward for ever;
 *  - neither end of a move may land in a period a check-in has closed: the same
 *    day rule the client's log writes obey (`lib/daily-log-permissions.ts`).
 *    A week the client has reported on does not change shape afterwards;
 *  - a target day may not hold any event that is not itself moving — status-
 *    agnostic, the `assertDateFree` posture — so a swap passes and a drop onto
 *    a logged day does not.
 *
 * The old "a past target is allowed only when that day has no logged workout"
 * clause is GONE with the logged-day lock it belonged to. It refused nothing the
 * rest of the policy does not already refuse: a logged day holds a completed
 * event, which the status-agnostic occupancy check below rejects on its own, and
 * a logged session is pinned by the first rule.
 *
 * Concurrency is the RPC's job: it re-checks ownership, status and the
 * from-date under row locks, so a coach move racing this call surfaces as
 * `drift`, never as a half-applied week.
 *
 * Nutrition follows the session (owner decision 2026-08-26) with no write of
 * its own: a day's target is computed from the session on it, so the day the
 * session left and the day it landed on re-price the moment the RPC commits.
 */
export async function applyClientLayout(
  clientId: string,
  moves: LayoutMove[]
): Promise<AppliedLayout> {
  // A move to its own day writes nothing.
  const real = moves.filter((m) => m.fromDate !== m.toDate);
  if (real.length === 0) return { moved: [] };

  const ids = real.map((m) => m.eventId);
  const [eventsRes, { weekday: checkInDay }, { logsOpenFrom }] =
    await Promise.all([
      supabaseAdmin
        .from("training_events")
        .select("id, date, status")
        .eq("client_id", clientId)
        .in("id", ids),
      getClientWeekAnchor(clientId),
      // The day rule's boundary, applied to both ends of every move.
      getLogWindow(clientId),
    ]);
  if (eventsRes.error) {
    throw new Error(`Failed to load events for layout: ${eventsRes.error.message}`);
  }

  const byId = new Map((eventsRes.data ?? []).map((e) => [e.id, e]));

  for (const m of real) {
    const event = byId.get(m.eventId);
    if (!event) throw new LayoutNotFoundError("Session not found");
    if (event.status !== "scheduled") {
      throw new LayoutPolicyError("A session that has been logged can't be moved");
    }
    if (event.date !== m.fromDate) throw new LayoutDriftError(LAYOUT_DRIFT_MESSAGE);

    const weekStart = getTrainingWeekStart(event.date, checkInDay);
    const weekEnd = getTrainingWeekEnd(event.date, checkInDay);
    if (m.toDate < weekStart || m.toDate > weekEnd) {
      throw new LayoutPolicyError("A session can only move within its own week");
    }

    // Both ends, not just the target: a session sitting inside a reported week
    // may not be moved OUT of it either, or the week the check-in described
    // would change shape after the fact.
    if (logsOpenFrom !== null && (m.fromDate < logsOpenFrom || m.toDate < logsOpenFrom)) {
      throw new LayoutPolicyError(
        "That week is in a check-in you've already sent and can't be changed"
      );
    }
  }

  // Occupancy, status-agnostic, ignoring the moving set. A read failure must
  // never be mistaken for "the day is free".
  const targets = [...new Set(real.map((m) => m.toDate))];
  const { data: occupants, error: occupantsError } = await supabaseAdmin
    .from("training_events")
    .select("id, date")
    .eq("client_id", clientId)
    .in("date", targets)
    .order("date", { ascending: true });
  if (occupantsError) {
    throw new Error(`Failed to check target days for layout: ${occupantsError.message}`);
  }
  const moving = new Set(ids);
  const blocker = (occupants ?? []).find((o) => !moving.has(o.id));
  if (blocker) throw new DateOccupiedError(occupiedMessage(blocker.date));

  const { error: rpcError } = await supabaseAdmin.rpc("move_training_events_atomic", {
    p_client_id: clientId,
    p_moves: real.map((m) => ({
      event_id: m.eventId,
      from_date: m.fromDate,
      to_date: m.toDate,
    })),
  });
  if (rpcError) throw translateRpcError(rpcError);

  return { moved: real };
}

/** The error `supabaseAdmin.rpc("move_training_events_atomic", …)` returns. */
export type MoveRpcError = { code?: string; message: string; details?: string };

/** What the RPC refused, read from its message; only `occupied` names a day. */
type MoveRpcFailure =
  | { kind: "occupied"; date: string }
  | { kind: "drift" | "not_found" | "not_scheduled" | "duplicate" | "other" };

/**
 * The RPC's message prefixes are its error contract (see migration 150), read
 * here for both of its callers — this service and the coach's `moveEvent` — so
 * the two cannot parse it differently; each answers the kind in its own
 * sentences. The index backstop is translated first: a raw 23505 from
 * `idx_training_events_one_scheduled_per_day` is thrown as the same sentence
 * the pre-check produces (CONVENTIONS §8).
 */
export function readMoveRpcError(error: MoveRpcError): MoveRpcFailure {
  rethrowIfAnyDateOccupied(error);
  const message = error.message ?? "";
  if (message.startsWith("drift:")) return { kind: "drift" };
  if (message.startsWith("occupied:")) {
    return { kind: "occupied", date: message.slice("occupied:".length).trim() };
  }
  if (message.startsWith("not_found:")) return { kind: "not_found" };
  if (message.startsWith("not_scheduled:")) return { kind: "not_scheduled" };
  if (message.startsWith("duplicate_")) return { kind: "duplicate" };
  return { kind: "other" };
}

/** The RPC's refusal in the client's sentences. */
function translateRpcError(error: MoveRpcError): Error {
  const failure = readMoveRpcError(error);
  switch (failure.kind) {
    case "drift":
      return new LayoutDriftError(LAYOUT_DRIFT_MESSAGE);
    case "occupied":
      return new DateOccupiedError(occupiedMessage(failure.date));
    case "not_found":
      return new LayoutNotFoundError("Session not found");
    case "not_scheduled":
      return new LayoutPolicyError("A session that has been logged can't be moved");
    case "duplicate":
      return new LayoutPolicyError("Two sessions can't land on the same day");
    case "other":
      return new Error(`Failed to apply layout: ${error.message ?? ""}`);
  }
}
