/**
 * Daily-log edit permissions — SERVER side.
 *
 * Reads the client's timezone + per-resource log state from the DB and applies the
 * pure `canEditDay` rule. Lives in `services/` (imports `supabaseAdmin`) so the pure
 * rule in `lib/daily-log-permissions.ts` stays client-safe. Route handlers import
 * `assertCanEdit` from here and translate `DayLockedError` into a 403.
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
 * for (client_id, date). All four tables carry client_id + date.
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
  resourceType: DailyLogResourceType
): Promise<DayEditState> {
  const { data: clientRow } = await supabaseAdmin
    .from("clients")
    .select("timezone")
    .eq("id", clientId)
    .single();
  const clientTimezone = clientRow?.timezone ?? "UTC";

  const { data: childRow } = await supabaseAdmin
    .from(RESOURCE_TABLE[resourceType])
    .select("id")
    .eq("client_id", clientId)
    .eq("date", date)
    .limit(1)
    .maybeSingle();

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
}): Promise<{ loggedStatus: DayLogStatus }> {
  const { clientId, date, resourceType } = params;
  const { editable, loggedStatus } = await getDayEditState(clientId, date, resourceType);
  if (!editable) {
    throw new DayLockedError(date, resourceType);
  }
  return { loggedStatus };
}
