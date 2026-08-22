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
 * function: /api/clients/overdue computes nextExpectedCheckIn here, and the
 * Clients roster's "due {date}" column computes it here too. Two callers, one
 * definition, nothing to drift.
 *
 * The service re-exports every symbol below, so its existing importers are
 * unchanged.
 */

import {
  addDays,
  differenceInDays,
  parseISODate,
  calculateCheckInPeriod,
  getTodayInTimezone,
} from "@/lib/date-helpers";
import { CRITICALLY_OVERDUE_DAYS } from "@/lib/constants";
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
 * Calculate when the next check-in is expected for a client.
 * Uses period-based calculation so the expected date always reflects
 * the current period, not the first missed one.
 * Returns null if client has no check-in schedule (frequency = 'none')
 */
export function calculateNextExpectedCheckIn(client: Client | ClientWithCheckInInfo): Date | null {
  const frequency = client.checkInFrequency ?? "weekly";

  if (frequency === "none") {
    return null;
  }

  if (client.expectedCheckInDay) {
    // The check-in lives on the CLIENT's calendar: "today" is the client's
    // local day (zero extra fetches — the Client object carries timezone).
    const today = getTodayInTimezone(client.timezone);
    const { periodEnd } = calculateCheckInPeriod(today, client.expectedCheckInDay);

    // Use period_end from the last check-in (accurate) with fallback to created_at
    const lastPeriodEnd = ("lastCheckInPeriodEnd" in client && client.lastCheckInPeriodEnd)
      ? client.lastCheckInPeriodEnd
      : undefined;

    if (lastPeriodEnd === periodEnd) {
      // Already checked in for current period — next expected is next week
      const nextEnd = new Date(periodEnd + "T00:00:00");
      nextEnd.setDate(nextEnd.getDate() + 7);
      return nextEnd;
    }

    // New client with no prior check-ins: don't expect a check-in for a period
    // that ended before the client was created (e.g. plan started Saturday,
    // check-in day is Friday — the previous Friday shouldn't count).
    if (!lastPeriodEnd) {
      const clientCreated = parseISODate(client.createdAt);
      const periodEndDate = new Date(periodEnd + "T00:00:00");
      if (periodEndDate < clientCreated) {
        // Current period predates the client — next expected is the following week
        const nextEnd = new Date(periodEndDate);
        nextEnd.setDate(nextEnd.getDate() + 7);
        return nextEnd;
      }
    }

    // Not checked in for current period — current period end is the expected date
    return new Date(periodEnd + "T00:00:00");
  }

  // Fallback for clients without expectedCheckInDay: loop forward from last check-in
  const lastCheckInDate = ("lastCheckInDate" in client && client.lastCheckInDate)
    ? parseISODate(client.lastCheckInDate)
    : parseISODate(client.createdAt);

  const frequencyDays = getFrequencyInDays(frequency, client.checkInFrequencyDays);
  let nextDate = addDays(lastCheckInDate, frequencyDays);
  const today = getTodayInTimezone(client.timezone);
  while (nextDate < today) {
    nextDate = addDays(nextDate, frequencyDays);
  }

  return nextDate;
}

/**
 * Check if a client is overdue for their check-in
 */
export function isClientOverdue(client: Client): boolean {
  const nextExpected = calculateNextExpectedCheckIn(client);

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
  const nextExpected = calculateNextExpectedCheckIn(client);

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
