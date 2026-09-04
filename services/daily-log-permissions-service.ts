/**
 * Daily-log edit permissions — SERVER side.
 *
 * Reads the client facts the boundary is derived from and applies the pure rule
 * in `lib/daily-log-permissions.ts`, which stays client-safe. Route handlers
 * import `assertCanEdit` from here and translate `DayLockedError` into a 403.
 *
 * The rule asks ONE question — which reporting period does this day belong to —
 * so there is no per-resource granularity any more. Nutrition, wellness, habits
 * and training all lock together with their day. The old per-habit narrowing
 * went with the logged-day rule it served: a habit's own log state decides
 * nothing now.
 */

import { supabaseAdmin } from "@/services/supabase-admin";
import {
  canEditDay,
  DayLockedError,
  resolveLogsOpenFrom,
  type DailyLogResourceType,
} from "@/lib/daily-log-permissions";

/** The columns the boundary is derived from, in one read. */
const LOG_WINDOW_COLUMNS = "timezone, next_check_in_due, start_date";

type DayEditState = {
  editable: boolean;
  logsOpenFrom: string | null;
  clientTimezone: string;
};

/**
 * The period end of the newest check-in this client has SENT, or null if they
 * never have. One indexed read: `idx_check_ins_client_period_unique` is
 * `(client_id, period_end) WHERE period_end IS NOT NULL` (migration 156), so
 * this is a backward index scan, and its partial condition also skips the legacy
 * rows that predate periods and could never close a week.
 */
export async function getLastSubmittedPeriodEnd(
  clientId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("check_ins")
    .select("period_end")
    .eq("client_id", clientId)
    .not("period_end", "is", null)
    .order("period_end", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Loud fallback: a swallowed error here would silently reopen every day a
  // submitted check-in has closed, which is the whole point of the rule.
  if (error) {
    console.error(
      "getLastSubmittedPeriodEnd: check-in period read failed, treating the client as never checked in",
      error
    );
    return null;
  }
  return data?.period_end ?? null;
}

/**
 * The client's boundary, without asking about a particular day — what the two
 * wires carry to the apps, and what the week-layout service applies to both ends
 * of every move.
 *
 * Two independent reads, issued together (CONVENTIONS §2, performance 11).
 */
export async function getLogWindow(
  clientId: string
): Promise<{ logsOpenFrom: string | null; clientTimezone: string }> {
  const [clientResult, lastSubmittedPeriodEnd] = await Promise.all([
    supabaseAdmin
      .from("clients")
      .select(LOG_WINDOW_COLUMNS)
      .eq("id", clientId)
      .single(),
    getLastSubmittedPeriodEnd(clientId),
  ]);

  // Loud fallback: a swallowed fetch error here silently judges the day lock on
  // UTC (the failure mode that hid the PGRST201 bug — see today-service).
  if (clientResult.error) {
    console.error(
      "getLogWindow: client fetch failed, falling back to UTC and no schedule",
      clientResult.error
    );
  }
  const clientRow = clientResult.data;
  const clientTimezone = clientRow?.timezone ?? "UTC";

  const logsOpenFrom: string | null = resolveLogsOpenFrom(
    {
      timezone: clientTimezone,
      nextCheckInDue: clientRow?.next_check_in_due,
      startDate: clientRow?.start_date,
    },
    lastSubmittedPeriodEnd
  );

  return { logsOpenFrom, clientTimezone };
}

/** The boundary, plus the answer for one day. */
export async function getDayEditState(
  clientId: string,
  date: string
): Promise<DayEditState> {
  const { logsOpenFrom, clientTimezone } = await getLogWindow(clientId);
  return {
    editable: canEditDay(date, logsOpenFrom, clientTimezone),
    logsOpenFrom,
    clientTimezone,
  };
}

/**
 * Guard for every client write against a dated row. Throws `DayLockedError`
 * when the day is not editable; routes catch the throw and return 403 via
 * `instanceof DayLockedError`.
 */
export async function assertCanEdit(params: {
  clientId: string;
  date: string;
  resourceType: DailyLogResourceType;
}): Promise<void> {
  const { clientId, date, resourceType } = params;
  const { editable } = await getDayEditState(clientId, date);
  if (!editable) {
    throw new DayLockedError(date, resourceType);
  }
}
