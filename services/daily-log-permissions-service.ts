/**
 * Daily-log edit permissions — SERVER side.
 *
 * Reads the client's timezone + per-resource log state from the DB and applies the
 * pure `canEditDay` rule. Lives in `services/` (imports `supabaseAdmin`) so the pure
 * rule in `lib/daily-log-permissions.ts` stays client-safe. Route handlers import
 * `assertCanEdit` from here and translate `DayLockedError` into a 403.
 *
 * Granularity: nutrition/wellness/training lock per-DAY (any child row that day ⇒
 * "logged"), since each is saved as one day record. Habits are toggled individually,
 * so the `habit` resource accepts an optional `habitId` that narrows the "logged"
 * check to a single habit — letting a missed past day be backfilled habit-by-habit
 * while each habit still locks once recorded. The pure `canEditDay` rule is unchanged.
 */

import { supabaseAdmin } from "@/services/supabase-admin";
import {
  canEditDay,
  DayLockedError,
  type DailyLogResourceType,
  type DayLogStatus,
} from "@/lib/daily-log-permissions";

/**
 * Each resource's "logged" state is the existence of a row in its own child table
 * for (client_id, date). All four tables carry client_id + date. `daily_habit_logs`
 * additionally carries daily_habit_id, which the habit resource filters on for
 * per-habit locking (see module docstring).
 */
const RESOURCE_TABLE = {
  nutrition: "nutrition_logs",
  wellness: "wellness_logs",
  training: "training_logs",
  habit: "daily_habit_logs",
} as const satisfies Record<DailyLogResourceType, string>;

export type DayEditState = {
  editable: boolean;
  loggedStatus: DayLogStatus;
  clientTimezone: string;
};

/**
 * Load the client's timezone + whether `resourceType` is already logged for `date`,
 * then decide editability via the pure `canEditDay` rule.
 *
 * loggedStatus is read from the resource's CHILD table — NOT the spine or the
 * `daily_logs_full` view: the view returns NULLs for both an absent and an empty
 * child, so it can't tell them apart, and the lock must be per-resource. Reading the
 * child also makes the two-step write self-heal — a failed child write leaves the day
 * editable, so the next attempt succeeds.
 */
export async function getDayEditState(
  clientId: string,
  date: string,
  resourceType: DailyLogResourceType,
  opts?: { habitId?: string }
): Promise<DayEditState> {
  const { data: clientRow } = await supabaseAdmin
    .from("clients")
    .select("timezone")
    .eq("id", clientId)
    .single();
  const clientTimezone = clientRow?.timezone ?? "UTC";

  let childQuery = supabaseAdmin
    .from(RESOURCE_TABLE[resourceType])
    .select("id")
    .eq("client_id", clientId)
    .eq("date", date);
  // Habits lock per-habit, not per-day: narrow the existence check to this habit so a
  // missed past day stays backfillable one habit at a time (see module docstring).
  if (resourceType === "habit" && opts?.habitId) {
    childQuery = childQuery.eq("daily_habit_id", opts.habitId);
  }
  const { data: childRow } = await childQuery.limit(1).maybeSingle();

  const loggedStatus: DayLogStatus = childRow ? "logged" : "never-logged";

  return {
    editable: canEditDay(date, loggedStatus, clientTimezone),
    loggedStatus,
    clientTimezone,
  };
}

/**
 * Guard for per-card writes. Throws `DayLockedError` when the day is not editable;
 * otherwise resolves with the resource's `loggedStatus` so callers can return 201
 * (first log) vs 200 (update) without a second query. Routes catch the throw and
 * return 403 via `instanceof DayLockedError`.
 */
export async function assertCanEdit(params: {
  clientId: string;
  date: string;
  resourceType: DailyLogResourceType;
  /** Habit resource only: narrows the lock to this specific habit (see module docstring). */
  habitId?: string;
}): Promise<{ loggedStatus: DayLogStatus }> {
  const { clientId, date, resourceType, habitId } = params;
  const { editable, loggedStatus } = await getDayEditState(clientId, date, resourceType, {
    habitId,
  });
  if (!editable) {
    throw new DayLockedError(date, resourceType);
  }
  return { loggedStatus };
}

/**
 * Training-specific date-edit lock. The "logged" signal for training is NOT the
 * `training_logs` spine (session logging never writes it) — it comes from real
 * `session_logs` / `training_events` state, which the caller already has, so it
 * passes `loggedStatus` directly. Applies the same pure `canEditDay` rule (today
 * editable; past + logged → locked; future → locked) and throws `DayLockedError`
 * → 403 when not editable.
 */
export async function assertCanEditTrainingDay(
  clientId: string,
  date: string,
  loggedStatus: DayLogStatus,
): Promise<void> {
  const { data: clientRow } = await supabaseAdmin
    .from("clients")
    .select("timezone")
    .eq("id", clientId)
    .single();
  const clientTimezone = clientRow?.timezone ?? "UTC";
  if (!canEditDay(date, loggedStatus, clientTimezone)) {
    throw new DayLockedError(date, "training");
  }
}
