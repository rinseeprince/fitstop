/**
 * The week anchor: which weekday a client's reporting week ENDS on.
 *
 * Training, nutrition targets, habits, wellness, the attention feed and the
 * client portal all cut their week here, and every one of them used to source
 * the weekday itself — twelve call sites, six of them issuing their own
 * `select("expected_check_in_day")`, and each free to spell the no-schedule
 * default its own way. They did: eleven passed `null` (Mon-Sun) and
 * training-week-summary-service passed `?? "monday"`, which the "week starts
 * the day AFTER the check-in day" rule then turned into a Tue-Mon week. The
 * same client's "this week" therefore covered two different weeks depending on
 * which surface asked.
 *
 * So the anchor is derived HERE and only here, and here is the ONE body that
 * changed when the stored weekday became a stored due date — all twelve callers
 * followed with no edit. `getTrainingWeekStart/End/Days` keep their maths; they
 * were never wrong, the sourcing was.
 *
 * Pure, and it stays pure: `components/clients/habits/habits-tab-content.tsx`
 * derives its week in the BROWSER off the `Client` object, so this module must
 * never reach `services/supabase-admin.ts` (`npm run check:service-key`). The
 * database-fetching twin is `getClientWeekAnchor`
 * (`services/check-in-week-service.ts`) — the same split as
 * `lib/date-helpers.ts` / `services/today-service.ts`.
 */

import type { DayOfWeek } from "@/types/check-in";

const DAYS_OF_WEEK: readonly DayOfWeek[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/**
 * The anchor for a client with no check-in schedule: their week runs **Mon-Sun**.
 *
 * Spelled as the day the week ENDS on, because that is what this module returns
 * and what `getTrainingWeekStart` consumes (it starts the week the day after).
 *
 * Owner decision, 2026-08-28, on the merits rather than on how many rows it
 * touches: a client with no check-in day gives nobody a reason to believe their
 * week ends on a Monday. Mon-Sun is what a coach means by "this week" when
 * nothing else is specified.
 */
export const NO_SCHEDULE_WEEK_ANCHOR: DayOfWeek = "sunday";

/**
 * The minimum a caller must hold to have its week anchored. Deliberately
 * structural rather than `Client`, so a two-column projection satisfies it
 * without inventing the columns it never fetched.
 */
export type CheckInWeekSource = {
  /** `clients.next_check_in_due`, as YYYY-MM-DD. */
  nextCheckInDue?: string | null;
};

/**
 * The weekday this client's reporting week ends on.
 *
 * Derived from the ONE stored fact — the due date — rather than from a second
 * stored copy of the weekday. A copy has to be kept in step; a calculation
 * cannot be out of step. Taking the weekday (rather than the date itself) is
 * what keeps a fortnightly client on a steady weekly rhythm: "the 7 days ending
 * on the due date" would leave every other week unassigned.
 *
 * Never null: a client with no schedule still needs a week boundary, and
 * returning null here would hand every caller the chance to spell the default
 * again.
 */
export function checkInWeekday(
  source: CheckInWeekSource | null | undefined
): DayOfWeek {
  const due = source?.nextCheckInDue;
  if (!due) return NO_SCHEDULE_WEEK_ANCHOR;
  // Local-midnight parse, matching every other date read in this codebase: a
  // bare YYYY-MM-DD parses as UTC midnight and reads back a day early west of
  // UTC through .getDay().
  const day = new Date(due.slice(0, 10) + "T00:00:00").getDay();
  return DAYS_OF_WEEK[day] ?? NO_SCHEDULE_WEEK_ANCHOR;
}
