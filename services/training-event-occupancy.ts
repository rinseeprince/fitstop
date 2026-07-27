import { supabaseAdmin } from "./supabase-admin";

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

function formatDay(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
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
