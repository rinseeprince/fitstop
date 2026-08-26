import { supabaseAdmin } from "./supabase-admin";
import { getClientTodayString } from "./today-service";
import { cascadeNutritionAfterTrainingChange } from "./nutrition-event-service";
import {
  DateOccupiedError,
  occupiedMessage,
  rethrowIfAnyDateOccupied,
} from "./training-event-occupancy";
import {
  dateOfTimestamp,
  getTrainingWeekEnd,
  getTrainingWeekStart,
} from "@/lib/date-helpers";

// =============================================================================
// Client week layout — the ONE write path for "a session changes date".
//
// A single move, a two-day swap and a whole-week rearrangement are the same
// operation at different sizes: a list of {event, from, to} applied in one
// transaction by `move_training_events_atomic` (migration 150). This service
// owns the POLICY the RPC deliberately does not — the rules a client's own
// calendar imposes — and translates the RPC's message contract into typed
// errors the route can answer with a sentence.
// =============================================================================

export type LayoutMove = { eventId: string; fromDate: string; toDate: string };
export type AppliedLayout = { moved: LayoutMove[] };

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
 *  - a target before the client's today is allowed only when that day has no
 *    logged workout (the backfill allowance: "I did Thursday's session on
 *    Tuesday and forgot to log it");
 *  - a target day may not hold any event that is not itself moving — status-
 *    agnostic, the `assertDateFree` posture — so a swap passes and a drop onto
 *    a logged day does not.
 * Concurrency is the RPC's job: it re-checks ownership, status and the
 * from-date under row locks, so a coach move racing this call surfaces as
 * `drift`, never as a half-applied week.
 *
 * Nutrition follows the session (owner decision 2026-08-26): one cascade over
 * every day touched, after the RPC commits. The cascade is not in the RPC's
 * transaction — the same seam every coach-side move has — so a cascade failure
 * leaves the calendar moved and nutrition stale until the next cascade.
 */
export async function applyClientLayout(
  clientId: string,
  moves: LayoutMove[]
): Promise<AppliedLayout> {
  // A move to its own day writes nothing and cascades nothing.
  const real = moves.filter((m) => m.fromDate !== m.toDate);
  if (real.length === 0) return { moved: [] };

  const ids = real.map((m) => m.eventId);
  const [eventsRes, clientRes, today] = await Promise.all([
    supabaseAdmin
      .from("training_events")
      .select("id, date, status")
      .eq("client_id", clientId)
      .in("id", ids),
    supabaseAdmin
      .from("clients")
      .select("expected_check_in_day")
      .eq("id", clientId)
      .maybeSingle(),
    getClientTodayString(clientId),
  ]);
  if (eventsRes.error) {
    throw new Error(`Failed to load events for layout: ${eventsRes.error.message}`);
  }
  if (clientRes.error) {
    throw new Error(`Failed to load client for layout: ${clientRes.error.message}`);
  }

  const byId = new Map((eventsRes.data ?? []).map((e) => [e.id, e]));
  const checkInDay = clientRes.data?.expected_check_in_day ?? null;

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
  }

  // Backfill allowance: a past target must not already hold a logged workout.
  // completed_at is TIMESTAMPTZ written from a bare date — the house range
  // pattern, compared by its calendar day.
  const pastTargets = [...new Set(real.map((m) => m.toDate).filter((d) => d < today))].sort();
  if (pastTargets.length > 0) {
    const { data: logs, error: logsError } = await supabaseAdmin
      .from("session_logs")
      .select("completed_at")
      .eq("client_id", clientId)
      .gte("completed_at", `${pastTargets[0]}T00:00:00`)
      .lte("completed_at", `${pastTargets[pastTargets.length - 1]}T23:59:59`);
    if (logsError) {
      throw new Error(`Failed to check logged days for layout: ${logsError.message}`);
    }
    const loggedDays = new Set((logs ?? []).map((l) => dateOfTimestamp(l.completed_at)));
    if (pastTargets.some((d) => loggedDays.has(d))) {
      throw new LayoutPolicyError("That day already has a logged workout");
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

  const dates = [...new Set(real.flatMap((m) => [m.fromDate, m.toDate]))].sort();
  await cascadeNutritionAfterTrainingChange(
    clientId,
    { kind: "dates", dates },
    "cascade-nutrition-events-from-client-layout"
  );

  return { moved: real };
}

/**
 * The RPC's message prefixes are its error contract (see migration 150). The
 * index backstop is translated first: a raw 23505 from
 * `idx_training_events_one_scheduled_per_day` becomes the same sentence the
 * pre-check produces (CONVENTIONS §8).
 */
function translateRpcError(error: { code?: string; message: string; details?: string }): Error {
  rethrowIfAnyDateOccupied(error);
  const message = error.message ?? "";
  if (message.startsWith("drift:")) return new LayoutDriftError(LAYOUT_DRIFT_MESSAGE);
  if (message.startsWith("occupied:")) {
    return new DateOccupiedError(occupiedMessage(message.slice("occupied:".length).trim()));
  }
  if (message.startsWith("not_found:")) return new LayoutNotFoundError("Session not found");
  if (message.startsWith("not_scheduled:")) {
    return new LayoutPolicyError("A session that has been logged can't be moved");
  }
  if (message.startsWith("duplicate_")) {
    return new LayoutPolicyError("Two sessions can't land on the same day");
  }
  return new Error(`Failed to apply layout: ${message}`);
}
