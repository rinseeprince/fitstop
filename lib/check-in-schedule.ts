/**
 * Check-in schedule maths. Pure — no database, no service-role client.
 *
 * Split out of services/check-in-tracking-service.ts so the BROWSER can use it.
 * That service imports supabaseAdmin, and scripts/check-service-key-leak.ts
 * walks the value-import graph from it and fails if any "use client" module can
 * reach it — so a client component that wanted a client's next check-in date had
 * no way to ask, even though the answer is a pure function of fields the roster
 * payload already carries.
 *
 * The point of the split is that the server and the browser now run the SAME
 * function: /api/clients/overdue resolves the due date here, and the Clients
 * roster's "due {date}" column resolves it here too. Two callers, one
 * definition, nothing to drift.
 *
 * The due date is now STORED (`clients.next_check_in_due`, migration 154), not
 * derived. What used to live here — computing "when is the next one due" from
 * the check-in weekday — answered that question with the end of the CURRENT
 * period, which is right for a client who is genuinely late and wrong the
 * moment the schedule changes: setting a client to Sunday on a Thursday
 * reported last Sunday, "4 days overdue", beside "Last submitted today". The
 * only maths left is the lapse roll below.
 *
 * The service re-exports every symbol below, so its existing importers are
 * unchanged.
 */

import {
  addDays,
  differenceInDays,
  getTodayInTimezone,
} from "@/lib/date-helpers";
import { CHECK_IN_GRACE_DAYS, CRITICALLY_OVERDUE_DAYS } from "@/lib/constants";
import type {
  Client,
  ClientWithCheckInInfo,
  CheckInFrequency,
  OverdueSeverity,
} from "@/types/check-in";

/**
 * Get frequency in days for a given check-in frequency
 */
export function getFrequencyInDays(
  frequency: CheckInFrequency,
  customDays?: number
): number {
  const frequencyMap: Record<CheckInFrequency, number> = {
    weekly: 7,
    biweekly: 14,
    monthly: 30,
    custom: customDays ?? 7,
    none: 0,
  };

  return frequencyMap[frequency];
}

/**
 * The date this client's next check-in is due, or null if they have no
 * schedule.
 *
 * Reads the stored date and rolls it forward by whole frequency steps past any
 * that has lapsed. The rule, stated for the first time here: a due check-in
 * stays satisfiable for CHECK_IN_GRACE_DAYS, then it lapses and the next
 * becomes live. Without the roll, a client who stopped checking in a year ago
 * would read as 365 days overdue instead of being measured against the check-in
 * they can still do something about.
 *
 * A PAST date is not a bug here — it is how overdue is defined
 * (getDaysUntilOrPastDue > 0), and it drives the roster's Overdue view, the
 * sidebar badge and the reminder sweep.
 */
export function resolveCheckInDue(
  client: Client | ClientWithCheckInInfo
): Date | null {
  const frequency = client.checkInFrequency ?? "weekly";
  if (frequency === "none" || !client.nextCheckInDue) {
    return null;
  }

  const due = new Date(client.nextCheckInDue.slice(0, 10) + "T00:00:00");

  const step = getFrequencyInDays(frequency, client.checkInFrequencyDays);
  if (step <= 0) return due;

  // The check-in lives on the CLIENT's calendar: "today" is the client's local
  // day (zero extra fetches — the Client object carries timezone).
  const today = getTodayInTimezone(client.timezone);
  let live = due;
  while (differenceInDays(today, live) > CHECK_IN_GRACE_DAYS) {
    live = addDays(live, step);
  }
  return live;
}

/**
 * Check if a client is overdue for their check-in
 */
export function isClientOverdue(client: Client): boolean {
  const nextExpected = resolveCheckInDue(client);

  if (!nextExpected) {
    return false; // No schedule = not overdue
  }

  // Client-local midnight vs midnight-of-due-day: the due day itself counts
  // as "due today", and overdue starts the NEXT local day — consistent with
  // getDaysUntilOrPastDue (0 on the due day) and the notifications copy.
  // (Previously a wall-clock compare flagged overdue from 00:01 on the due
  // day; behavior change accepted in Session 7.84.)
  const today = getTodayInTimezone(client.timezone);
  return today > nextExpected;
}

/**
 * Get days until check-in is due (negative) or days overdue (positive)
 * Returns 0 if no check-in schedule
 */
export function getDaysUntilOrPastDue(client: Client): number {
  const nextExpected = resolveCheckInDue(client);

  if (!nextExpected) {
    return 0;
  }

  const today = getTodayInTimezone(client.timezone);
  return differenceInDays(today, nextExpected);
}

/**
 * Categorize overdue severity based on days overdue
 */
export function getOverdueSeverity(daysOverdue: number): OverdueSeverity {
  if (daysOverdue < -3) return "upcoming";
  if (daysOverdue <= 0) return "due_soon";
  if (daysOverdue < CRITICALLY_OVERDUE_DAYS) return "overdue";
  return "critically_overdue";
}
