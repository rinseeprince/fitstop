import { format } from "date-fns";
import { supabaseAdmin } from "./supabase-admin";

// Two rules every training-event write path must honour, plus the read the
// second one needs:
//   1. one scheduled session per client per day  (`assertDateFree`)
//   2. a logged day's prescription is frozen     (`assertSessionUnlogged`)
// Both are pre-checks that produce a sentence a coach can act on, and both fail
// loudly on a read error rather than letting a write through the guard.

/**
 * One session per client per day (launch scope — see migration 136).
 *
 * The calendar's original guards keyed on `training_session_id`, which stopped
 * meaning anything once whole-program placement gave each placed day its own
 * cloned session row — they have been silent no-ops ever since, which is how
 * two sessions ended up stacked on dates no UI could clean up.
 *
 * Two layers, deliberately different in scope:
 *  - `assertDateFree` is status-AGNOSTIC, so a scheduled session cannot be
 *    dropped onto a day the client has already logged;
 *  - migration 136's index covers `status = 'scheduled'` only, so an early log
 *    can still coexist with the date-walk's regeneration.
 * The index is the backstop for paths added later; the pre-check is what
 * produces a sentence a coach can act on.
 *
 * **`assertDateFree` is on the three single-date paths, not on every writer** —
 * move, duplicate, and the library-session drop (`training-event-calendar-
 * service.ts`, `library-placement-service.ts`). Whole-program placement and the
 * amendment deliberately do NOT pre-check: each one first deletes the future
 * `scheduled` events in the window it is about to fill, so a per-date question
 * is one it has already answered. What that clear does not remove is a
 * non-scheduled survivor (an early log), and a concurrent write can still land
 * one between the clear and the upsert — which is what `rethrowIfDateOccupied`
 * is for on the walk. Do not "fix" those two by adding a pre-check; it would
 * reject the window they just vacated.
 */
export class DateOccupiedError extends Error {}

/** Postgres unique-violation on migration 136's index. */
const UNIQUE_VIOLATION = "23505";
const OCCUPANCY_INDEX = "idx_training_events_one_scheduled_per_day";

/**
 * The app's date spelling, month-first — `EEE, MMM d`, as used by the calendar
 * tray's header, the amend and delete dialogs, the metric and exercise charts
 * and the check-in surfaces. Both messages below are read beside those, so they
 * follow the convention rather than setting a second one. This function was the
 * product's ONLY day-first spelling until Phase 4; do not reintroduce one.
 *
 * **`placed-session-editor.tsx`'s standing lock line is the same sentence as
 * `loggedMessage` and spells the same pattern — the two must keep agreeing.**
 * Both follow the convention rather than each other, so if it moves, both move.
 *
 * date-fns rather than `toLocaleDateString`, so the pattern is spelled the way
 * the rest of the app spells it and no `Intl` call lives outside
 * `lib/date-helpers.ts` (CONVENTIONS §6).
 */
function formatDay(date: string): string {
  return format(new Date(date + "T00:00:00"), "EEE, MMM d");
}

function occupiedMessage(date: string): string {
  return `${formatDay(date)} already has a session`;
}

/**
 * Throws DateOccupiedError when the client already has an event on `date`.
 *
 * @param ignoreEventId the event being moved — a move onto its own date is not
 *   a collision, and without this every move would reject itself.
 */
export async function assertDateFree(
  clientId: string,
  date: string,
  ignoreEventId?: string
): Promise<void> {
  let query = supabaseAdmin
    .from("training_events")
    .select("id")
    .eq("client_id", clientId)
    .eq("date", date);

  if (ignoreEventId) query = query.neq("id", ignoreEventId);

  const { data, error } = await query.limit(1);

  // Fail loudly: a read failure here must not be mistaken for "the day is free"
  // and let a write through the guard it exists to enforce.
  if (error) throw new Error(`Failed to check date availability: ${error.message}`);
  if (data && data.length > 0) throw new DateOccupiedError(occupiedMessage(date));
}

/**
 * Does the client already have a COMPLETED (or partial) workout on `date`?
 * Whole-program placement starts on a day the coach picks; when that day already
 * holds a logged session the placed program's first session lands beside it and
 * the client's day shows two workouts. The place route asks this and answers
 * with a warn-first 409 ("start anyway?") rather than silently stacking them.
 * Status-scoped, unlike `assertDateFree`: a scheduled/missed/skipped row on the
 * day is the placement's own business (it clears future scheduled rows first).
 */
export async function hasCompletedWorkoutOn(clientId: string, date: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("training_events")
    .select("id")
    .eq("client_id", clientId)
    .eq("date", date)
    .in("status", ["completed", "partial"])
    .limit(1);
  if (error) throw new Error(`Failed to check the start day's workouts: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * Re-throws a unique violation from migration 136's index as the same
 * coach-readable error the pre-check produces.
 *
 * Needed because the generated-event upserts arbitrate on
 * `(client_id, training_session_id, date)` with ignoreDuplicates — an arbiter
 * that does NOT cover the new index, so a collision there surfaces as a raw
 * Postgres error rather than being skipped (CONVENTIONS §10: never show a coach
 * "duplicate key value violates unique constraint").
 */
export function rethrowIfDateOccupied(error: unknown, date: string): void {
  if (isOccupancyViolation(error)) throw new DateOccupiedError(occupiedMessage(date));
}

/**
 * Same translation for a BULK write, where the caller cannot know which of the
 * rows collided. Postgres names the offending values in the error detail
 * (`Key (client_id, date)=(…, 2026-08-14) already exists.`), so the date is
 * recovered from there; when it cannot be parsed the coach still gets a sentence
 * rather than a constraint name.
 */
export function rethrowIfAnyDateOccupied(error: unknown): void {
  if (!isOccupancyViolation(error)) return;
  const detail = (error as { details?: string; message?: string } | null);
  const match = `${detail?.details ?? ""} ${detail?.message ?? ""}`.match(/\d{4}-\d{2}-\d{2}/);
  throw new DateOccupiedError(
    match ? occupiedMessage(match[0]) : "One of those days already has a session"
  );
}

function isOccupancyViolation(error: unknown): boolean {
  const pgError = error as { code?: string; message?: string } | null;
  return (
    pgError?.code === UNIQUE_VIOLATION &&
    (pgError.message ?? "").includes(OCCUPANCY_INDEX)
  );
}

// ---------------------------------------------------------------------------
// Rule 2 — a logged day's prescription is frozen.
// ---------------------------------------------------------------------------

export type SessionEventLink = {
  id: string;
  date: string;
  status: string;
  isModified: boolean;
};

/**
 * The calendar events linked to one placed session, client-scoped.
 *
 * **It must keep returning past and NON-SCHEDULED events, because
 * `assertSessionUnlogged` below is the caller that needs them** — narrowing this
 * to `status = 'scheduled'` would leave that assertion nothing to find and
 * silently disable the logged-day lock.
 *
 * The list shape is earned three ways: `assertSessionUnlogged`'s `find` over the
 * date-ascending list (it names the EARLIEST logged day), the tray's
 * `loggedEvent` / `futureScheduledCount`, and genuine multi-event sessions — a
 * per-event duplicate (`duplicateEvent`) copies `training_session_id`, so one
 * session CAN own two future scheduled events and the tray's save-scope dialog
 * does open then. Narrowing this read licenses nothing.
 */
export async function getSessionEventLinks(
  sessionId: string,
  clientId: string,
): Promise<SessionEventLink[]> {
  const { data, error } = await supabaseAdmin
    .from("training_events")
    .select("id, date, status, is_modified")
    .eq("training_session_id", sessionId)
    .eq("client_id", clientId)
    .order("date", { ascending: true });

  if (error) throw new Error(`Failed to fetch session events: ${error.message}`);

  return (data ?? []).map((e) => ({
    id: e.id,
    date: e.date,
    status: e.status,
    isModified: e.is_modified ?? false,
  }));
}

/**
 * Thrown when a coach edit would rewrite the prescription under a day the
 * client has already logged. Routes translate it to 409.
 */
export class SessionLoggedError extends Error {}

function loggedMessage(date: string): string {
  return `The client logged this session on ${formatDay(date)}, so it can no longer be edited`;
}

/**
 * Throws SessionLoggedError when any event linked to `sessionId` has left the
 * `scheduled` state.
 *
 * **The predicate is `status !== "scheduled"`, and it is deliberately the same
 * sentence `program-builder-lock-model.ts:63` says** — the plan builder locks a
 * slot on exactly this test, so the two surfaces cannot disagree about whether
 * a session is editable. Three places now spell it: that line, this assertion,
 * and the placed-session tray's own gate (`use-placed-session-editor.ts`, which
 * cannot import this module — it reaches `supabaseAdmin`). Whoever changes the
 * rule changes all three.
 *
 * Called INSIDE `cloneSessionForEvent` and `replaceSessionFull` rather than at
 * their routes, so a future caller inherits it. Both call it AFTER proving the
 * session belongs to the client, so a foreign sessionId still reads as not
 * found rather than as locked.
 *
 * Links come back date-ascending, so the message names the EARLIEST logged
 * occurrence. A read failure propagates as `getSessionEventLinks`' own error:
 * the same fail-loudly posture as `assertDateFree` — a failed read must never
 * be mistaken for "nothing is logged".
 */
export async function assertSessionUnlogged(
  sessionId: string,
  clientId: string,
): Promise<void> {
  const links = await getSessionEventLinks(sessionId, clientId);
  const logged = links.find((e) => e.status !== "scheduled");
  if (logged) throw new SessionLoggedError(loggedMessage(logged.date));
}
