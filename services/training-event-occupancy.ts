import { supabaseAdmin } from "./supabase-admin";

/**
 * One session per client per day (launch scope — see migration 136).
 *
 * Every write path that can put an event on a date goes through here. The
 * calendar's original guards keyed on `training_session_id`, which stopped
 * meaning anything once whole-program placement gave each placed day its own
 * cloned session row — they have been silent no-ops ever since, which is how
 * two sessions ended up stacked on dates no UI could clean up.
 *
 * Two layers, deliberately different in scope:
 *  - this check is status-AGNOSTIC, so a scheduled session cannot be dropped
 *    onto a day the client has already logged;
 *  - migration 136's index covers `status = 'scheduled'` only, so an early log
 *    can still coexist with the date-walk's regeneration.
 * The index is the backstop for paths added later; this check is what produces
 * a sentence a coach can act on.
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
  const pgError = error as { code?: string; message?: string } | null;
  if (
    pgError?.code === UNIQUE_VIOLATION &&
    (pgError.message ?? "").includes(OCCUPANCY_INDEX)
  ) {
    throw new DateOccupiedError(occupiedMessage(date));
  }
}
