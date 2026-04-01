/**
 * Date utility functions for check-in tracking
 * Handles date calculations for check-in schedules, overdue detection, and adherence
 */

import type { DayOfWeek } from "@/types/check-in";

/**
 * Add days to a date
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Calculate difference in days between two dates
 * Returns positive number if date2 is after date1
 */
export function differenceInDays(date1: Date, date2: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  const utc1 = Date.UTC(date1.getFullYear(), date1.getMonth(), date1.getDate());
  const utc2 = Date.UTC(date2.getFullYear(), date2.getMonth(), date2.getDate());
  return Math.floor((utc1 - utc2) / msPerDay);
}

/**
 * Calculate difference in hours between two dates
 */
export function differenceInHours(date1: Date, date2: Date): number {
  const msPerHour = 1000 * 60 * 60;
  return Math.floor((date1.getTime() - date2.getTime()) / msPerHour);
}

/**
 * Get the day of week from a date (0 = Sunday, 6 = Saturday)
 */
export function getDayOfWeek(date: Date): number {
  return date.getDay();
}

/**
 * Get the next occurrence of a specific day of week from a given date
 * @param fromDate - Starting date
 * @param targetDay - Target day of week ('monday', 'tuesday', etc.)
 * @returns Date of the next occurrence of that day
 */
export function getNextDayOfWeek(fromDate: Date, targetDay: DayOfWeek): Date {
  const dayMap: Record<DayOfWeek, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };

  const targetDayNum = dayMap[targetDay];
  const currentDayNum = getDayOfWeek(fromDate);

  // Calculate days until target day
  let daysUntilTarget = targetDayNum - currentDayNum;

  // If target day is today or has passed this week, get next week's occurrence
  if (daysUntilTarget <= 0) {
    daysUntilTarget += 7;
  }

  return addDays(fromDate, daysUntilTarget);
}

/**
 * Check if a date is today
 */
export function isToday(date: Date): boolean {
  const today = new Date();
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
}

/**
 * Check if a date is in the past
 */
export function isPast(date: Date): boolean {
  const now = new Date();
  return date < now && !isToday(date);
}

/**
 * Format date as ISO string (YYYY-MM-DD)
 */
export function formatDateISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Parse ISO date string to Date object
 */
export function parseISODate(dateString: string): Date {
  return new Date(dateString);
}

/**
 * Get start of day (midnight)
 */
export function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Get end of day (23:59:59.999)
 */
export function endOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

const DAY_MAP: Record<DayOfWeek, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/**
 * Calculate the fixed 7-day check-in period based on the client's expected check-in day.
 *
 * The period ends on the most recent occurrence of `expectedCheckInDay` on or before `checkInDate`,
 * and starts 6 days before that (7-day inclusive window).
 *
 * Example: expectedCheckInDay = "sunday", checkInDate = Wed March 11
 *   → Most recent Sunday on or before March 11 = March 8
 *   → periodEnd = "2026-03-08", periodStart = "2026-03-02"
 */
export function calculateCheckInPeriod(
  checkInDate: Date,
  expectedCheckInDay: DayOfWeek
): { periodStart: string; periodEnd: string } {
  const targetDayNum = DAY_MAP[expectedCheckInDay];
  const currentDayNum = checkInDate.getDay();

  // Days to go back to reach the most recent target day on or before checkInDate
  let daysBack = currentDayNum - targetDayNum;
  if (daysBack < 0) daysBack += 7;

  const periodEndDate = new Date(checkInDate);
  periodEndDate.setDate(periodEndDate.getDate() - daysBack);

  const periodStartDate = new Date(periodEndDate);
  periodStartDate.setDate(periodStartDate.getDate() - 6);

  return {
    periodStart: formatDateISO(periodStartDate),
    periodEnd: formatDateISO(periodEndDate),
  };
}

export type CheckInGateStatus = "available" | "completed" | "not_due" | "overdue";

/**
 * Determine the check-in gate status for a client.
 *
 * - 'completed'  — a check-in already exists for the current period
 * - 'not_due'    — today is before the expected check-in day for this period
 * - 'available'  — it's the due day (or within grace window) and no check-in yet
 * - 'overdue'    — past the due day, grace window still open, no check-in yet
 */
export function getCheckInStatus(
  expectedCheckInDay: DayOfWeek,
  lastCheckInPeriodEnd: string | null,
  today: Date
): { status: CheckInGateStatus; periodStart: string; periodEnd: string; nextDueDate: string } {
  const { periodStart, periodEnd } = calculateCheckInPeriod(today, expectedCheckInDay);

  // Check if the last check-in covers this exact period
  if (lastCheckInPeriodEnd && lastCheckInPeriodEnd === periodEnd) {
    return { status: "completed", periodStart, periodEnd, nextDueDate: getNextPeriodEnd(periodEnd) };
  }

  const todayStr = formatDateISO(today);

  // Brand-new client with no prior check-ins who is past their due day:
  // push to next week. If today IS the due day, fall through to "available".
  if (!lastCheckInPeriodEnd && todayStr > periodEnd) {
    const nextDueDate = getNextPeriodEnd(periodEnd);
    return { status: "not_due", periodStart, periodEnd, nextDueDate };
  }

  if (todayStr < periodEnd) {
    // Today is before the expected check-in day
    return { status: "not_due", periodStart, periodEnd, nextDueDate: periodEnd };
  }

  if (todayStr === periodEnd) {
    return { status: "available", periodStart, periodEnd, nextDueDate: periodEnd };
  }

  // Past the due day — still within grace window (until day before next periodEnd)
  return { status: "overdue", periodStart, periodEnd, nextDueDate: periodEnd };
}

/** Advance a periodEnd date string by 7 days */
function getNextPeriodEnd(periodEnd: string): string {
  const d = new Date(periodEnd + "T00:00:00");
  d.setDate(d.getDate() + 7);
  return formatDateISO(d);
}
