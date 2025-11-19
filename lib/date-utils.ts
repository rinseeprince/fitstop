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
