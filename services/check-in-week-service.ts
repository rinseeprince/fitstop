import { supabaseAdmin } from "./supabase-admin";
import { checkInWeekday } from "@/lib/check-in-week";
import type { DayOfWeek } from "@/types/check-in";

/**
 * The two client facts every week-scoped read needs: the weekday its week ends
 * on, and the origin a partial first week clamps forward to. They travel
 * together because `resolveCheckInWindow(today, checkInDay, startDate)` already
 * pairs them, and because fetching them apart would cost the two history
 * summaries a second round trip for one column.
 */
type ClientWeekAnchor = {
  weekday: DayOfWeek;
  startDate: string | null;
};

/**
 * The single `clients` read behind the week anchor.
 *
 * Six separate `select("expected_check_in_day")` queries used to sit at the top
 * of six week-scoped readers, each restating both the column and its own idea
 * of the no-schedule default. This is that read, once — the DB-fetching twin of
 * the pure `checkInWeekday`, for call sites holding only a clientId. When a
 * `Client` record is already in scope, call `checkInWeekday` directly and pay
 * nothing.
 *
 * A missing row or a failed read resolves to the no-schedule anchor rather than
 * throwing: every caller's previous behaviour on a null row was the default
 * week, and a week boundary is not the place to fail a request.
 */
export async function getClientWeekAnchor(
  clientId: string
): Promise<ClientWeekAnchor> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("next_check_in_due, start_date")
    .eq("id", clientId)
    .maybeSingle();

  if (error) {
    console.error(
      "getClientWeekAnchor: client fetch failed, falling back to the default week",
      error
    );
  }

  return {
    weekday: checkInWeekday({ nextCheckInDue: data?.next_check_in_due }),
    startDate: data?.start_date ?? null,
  };
}
