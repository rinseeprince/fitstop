/**
 * Date utility functions for consistent date handling across the application
 */

import type { DayOfWeek } from "@/types/check-in";

/**
 * Returns today's date as a YYYY-MM-DD string in local timezone
 * @returns {string} Today's date in YYYY-MM-DD format
 */
export const getTodayDateString = (): string => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Validates an IANA time zone string, returning it if usable or "UTC" otherwise.
 * Guards against bad/unknown zones (e.g. "Mars/Olympus") a client could set
 * manually pre-launch — `Intl.DateTimeFormat` throws RangeError on those.
 */
export const safeTimeZone = (timeZone: string | null | undefined): string => {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
};

/**
 * Returns "today" as a YYYY-MM-DD string in the given IANA time zone.
 * Uses Intl so the DST offset in effect at `now` is applied correctly; falls back
 * to UTC for invalid/unknown zones (never throws). `now` is injectable for testing.
 *
 * @param {string} timeZone - IANA zone, e.g. "America/Los_Angeles"
 * @param {Date} [now] - the instant to resolve (defaults to new Date())
 * @returns {string} The client-local date in YYYY-MM-DD format
 */
export const getTodayDateStringInTimezone = (
  timeZone: string,
  now: Date = new Date()
): string => {
  const zone = safeTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
};

/**
 * Returns "today" in the given IANA zone as a local-midnight Date, for the
 * injectable-Date helpers (getCheckInStatus / resolveCheckInWindow /
 * calculateCheckInPeriod) whose internal math uses local getters
 * (.getDay() / formatDateISO). Deliberately NOT parseISODate: that parses
 * bare YYYY-MM-DD as UTC midnight, which is off by one day west of UTC when
 * read back through local getters. The "T00:00:00" suffix forces local
 * parsing — the established codebase idiom.
 */
export const getTodayInTimezone = (
  timeZone: string,
  now: Date = new Date()
): Date => new Date(getTodayDateStringInTimezone(timeZone, now) + "T00:00:00");

/**
 * Returns the device's IANA time zone, or undefined when it can't be resolved
 * (older runtimes, locked-down environments). Lives here so date-helpers stays
 * the only owner of Intl — the timezone auto-sync hooks import this instead of
 * touching Intl themselves.
 */
export const getDeviceTimeZone = (): string | undefined => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
};

/**
 * Returns a date string in YYYY-MM-DD format from a Date object in local timezone
 * @param {Date} date - The date to format
 * @returns {string} The date in YYYY-MM-DD format
 */
export const getDateString = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Convert a YYYY-MM-DD string to an integer day number (days since the Unix epoch),
 * UTC-anchored so it is timezone/DST-neutral and safe to compare or subtract.
 * Used for streak gaps-and-islands and check-in period bucketing.
 * @param {string} dateStr - a YYYY-MM-DD calendar date
 * @returns {number} the day number (e.g. 0 for 1970-01-01)
 */
export const dateStringToDayNumber = (dateStr: string): number => {
  const [year, month, day] = dateStr.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
};

/**
 * Parses a `?date=` query-param value into a safe YYYY-MM-DD string, falling back
 * to today (local) when the value is missing, malformed, or not a real calendar date.
 * The round-trip check (`getDateString(parsed) === raw`) rejects values that pass the
 * shape regex but roll over, e.g. "2026-02-30" or "2026-13-01". Shared by the client
 * home view and the per-day detail pages so they resolve the URL date identically.
 *
 * @param {string | null} raw - the raw query-param value
 * @returns {string} a valid YYYY-MM-DD date (today's date if `raw` is unusable)
 */
export const parseDateParamOrToday = (raw: string | null): string => {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return getTodayDateString();
  const parsed = new Date(raw + "T00:00:00");
  if (Number.isNaN(parsed.getTime())) return getTodayDateString();
  if (getDateString(parsed) !== raw) return getTodayDateString();
  return raw;
};

/**
 * Returns a date N days ago from today as a YYYY-MM-DD string in local timezone
 * @param {number} days - Number of days to subtract from today
 * @returns {string} The date in YYYY-MM-DD format
 */
export const getDateDaysAgo = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return getDateString(date);
};

/**
 * Returns a date N days from a given date as a YYYY-MM-DD string in local timezone
 * @param {Date} fromDate - The starting date
 * @param {number} days - Number of days to add (negative for past dates)
 * @returns {string} The date in YYYY-MM-DD format
 */
export const getDateDaysFrom = (fromDate: Date, days: number): string => {
  const date = new Date(fromDate);
  date.setDate(date.getDate() + days);
  return getDateString(date);
};

/**
 * Returns the Monday of the week containing the given date
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @returns {string} Monday's date in YYYY-MM-DD format
 */
export const getWeekStart = (dateString: string): string => {
  const date = new Date(dateString + 'T00:00:00');
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
  date.setDate(diff);
  return getDateString(date);
};

/**
 * Returns the Sunday of the week containing the given date
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @returns {string} Sunday's date in YYYY-MM-DD format
 */
export const getWeekEnd = (dateString: string): string => {
  const date = new Date(dateString + 'T00:00:00');
  const day = date.getDay();
  const diff = date.getDate() - day + 7;
  date.setDate(diff);
  return getDateString(date);
};

/**
 * Returns an array of 7 dates for the week containing the given date
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @returns {string[]} Array of dates in YYYY-MM-DD format, Monday to Sunday
 */
export const getWeekDays = (dateString: string): string[] => {
  const monday = getWeekStart(dateString);
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(monday + 'T00:00:00');
    date.setDate(date.getDate() + i);
    days.push(getDateString(date));
  }
  return days;
};

/**
 * Day name to JS getDay() number mapping
 */
export const DAY_NUM: Record<DayOfWeek | string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

/**
 * JS getDay() number to day name mapping (reverse of DAY_NUM)
 */
export const DAY_NAMES: Record<number, DayOfWeek> = {
  0: "sunday", 1: "monday", 2: "tuesday", 3: "wednesday",
  4: "thursday", 5: "friday", 6: "saturday",
};

/**
 * Returns the start of the training week containing dateString.
 * Training week starts the day after the client's check-in day.
 * Defaults to Monday when checkInDay is null/undefined (backward compatible).
 */
export const getTrainingWeekStart = (
  dateString: string,
  checkInDay?: string | null
): string => {
  const weekStartDayNum = checkInDay
    ? (DAY_NUM[checkInDay.toLowerCase()] + 1) % 7
    : 1; // Monday
  const date = new Date(dateString + 'T00:00:00');
  const current = date.getDay();
  let diff = current - weekStartDayNum;
  if (diff < 0) diff += 7;
  date.setDate(date.getDate() - diff);
  return getDateString(date);
};

/**
 * Returns the end of the training week containing dateString (6 days after week start).
 */
export const getTrainingWeekEnd = (
  dateString: string,
  checkInDay?: string | null
): string => {
  const start = new Date(getTrainingWeekStart(dateString, checkInDay) + 'T00:00:00');
  start.setDate(start.getDate() + 6);
  return getDateString(start);
};

/**
 * Returns an array of 7 dates for the training week containing the given date.
 * Uses getTrainingWeekStart to determine the first day based on the client's check-in day.
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @param {string | null} checkInDay - Client's check-in day (e.g. "wednesday"). Defaults to Monday start.
 * @returns {string[]} Array of 7 dates in YYYY-MM-DD format
 */
export const getTrainingWeekDays = (
  dateString: string,
  checkInDay?: string | null
): string[] => {
  const start = getTrainingWeekStart(dateString, checkInDay);
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(start + 'T00:00:00');
    date.setDate(date.getDate() + i);
    days.push(getDateString(date));
  }
  return days;
};

// ---------------------------------------------------------------------------
// Check-in and Date math helpers (formerly lib/date-utils.ts)
// ---------------------------------------------------------------------------

/**
 * Add days to a date
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Add days to a YYYY-MM-DD date string, returning YYYY-MM-DD. UTC-anchored end
 * to end so the result never shifts with the server's local timezone (a
 * parse-UTC/format-local mix loses a day west of UTC).
 */
export function addDaysToDateString(dateString: string, days: number): string {
  const d = new Date(dateString + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Every calendar date from `startDate` to `endDate` INCLUSIVE, as YYYY-MM-DD.
 * Returns `[]` when the range is inverted (end before start) — callers treat an
 * empty list as "nothing to do" rather than a silent full-range fallback.
 *
 * UTC-anchored via `addDaysToDateString`, so the list never shifts with the
 * server's local timezone the way a `new Date(s + "T00:00:00")` step loop does.
 * Written for the nutrition cascade, which needs one explicit date list driving
 * both its DELETE and its regenerate.
 */
export function expandDateRange(startDate: string, endDate: string): string[] {
  if (endDate < startDate) return [];
  const dates: string[] = [];
  for (let d = startDate; d <= endDate; d = addDaysToDateString(d, 1)) {
    dates.push(d);
  }
  return dates;
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
 * Format date as ISO string (YYYY-MM-DD)
 */
export function formatDateISO(date: Date): string {
  return getDateString(date);
}

/**
 * Parse ISO date string to Date object
 */
export function parseISODate(dateString: string): Date {
  return new Date(dateString);
}

/**
 * Calculate the fixed 7-day check-in period based on the client's expected check-in day.
 *
 * The period ends on the most recent occurrence of `expectedCheckInDay` on or before `checkInDate`,
 * and starts 6 days before that (7-day inclusive window).
 */
export function calculateCheckInPeriod(
  checkInDate: Date,
  expectedCheckInDay: DayOfWeek
): { periodStart: string; periodEnd: string } {
  const targetDayNum = DAY_NUM[expectedCheckInDay];
  const currentDayNum = checkInDate.getDay();

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

/**
 * Resolve the daily-log window a check-in form/summary and the submitted check-in
 * should cover. Shared by the check-in-context route and submitCheckIn so the
 * displayed period and the stored period_start/period_end always agree.
 *
 * The window is the fixed 7-day period ending on the client's check-in day
 * (`calculateCheckInPeriod`), with `periodStart` clamped forward to the activation
 * date (`clients.start_date`) for a **partial first week** — the same
 * `effectiveStart` clamp the coach-side history summaries use. One formula covers
 * both cases:
 * - Established client: `start_date` ≪ the window start → no clamp → most-recent
 *   7-day window (older history is never back-filled into a late first check-in).
 * - Mid-week activation: `start_date` falls inside the window → clamp → partial
 *   window running from activation to the check-in day (e.g. "3/3", not "3/7").
 * - No check-in day (edge/misconfig): trailing 7 days ending today.
 */
export function resolveCheckInWindow(
  today: Date,
  checkInDay: DayOfWeek | null | undefined,
  startDate: string | null | undefined
): { periodStart: string; periodEnd: string } {
  if (checkInDay) {
    const { periodStart: weekStart, periodEnd } = calculateCheckInPeriod(today, checkInDay);
    const start = startDate ? startDate.slice(0, 10) : null; // normalise to YYYY-MM-DD
    return { periodStart: start && start > weekStart ? start : weekStart, periodEnd };
  }
  const periodEnd = formatDateISO(today);
  const startObj = new Date(today);
  startObj.setDate(startObj.getDate() - 6);
  return { periodStart: formatDateISO(startObj), periodEnd };
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
  today: Date,
  startDate?: string | null
): { status: CheckInGateStatus; periodStart: string; periodEnd: string; nextDueDate: string } {
  const { periodStart, periodEnd } = calculateCheckInPeriod(today, expectedCheckInDay);

  if (lastCheckInPeriodEnd && lastCheckInPeriodEnd === periodEnd) {
    return { status: "completed", periodStart, periodEnd, nextDueDate: getNextPeriodEnd(periodEnd) };
  }

  const todayStr = formatDateISO(today);

  // Brand-new client with no prior check-ins who is past their due day. Only push
  // to next week when this period's check-in day predates activation (a pre-activation
  // window — there was nothing to check in for). Otherwise the client simply missed
  // their first check-in and can still log it late (overdue) until the next check-in
  // day, like any other check-in. Default (no start date supplied) preserves the
  // legacy "push to next week" behavior.
  if (!lastCheckInPeriodEnd && todayStr > periodEnd) {
    const pushToNextWeek = startDate ? periodEnd < startDate.slice(0, 10) : true;
    if (pushToNextWeek) {
      const nextDueDate = getNextPeriodEnd(periodEnd);
      return { status: "not_due", periodStart, periodEnd, nextDueDate };
    }
    // else: missed first check-in — fall through to the available/overdue logic below
  }

  if (todayStr < periodEnd) {
    return { status: "not_due", periodStart, periodEnd, nextDueDate: periodEnd };
  }

  if (todayStr === periodEnd) {
    return { status: "available", periodStart, periodEnd, nextDueDate: periodEnd };
  }

  return { status: "overdue", periodStart, periodEnd, nextDueDate: periodEnd };
}

/** Advance a periodEnd date string by 7 days */
function getNextPeriodEnd(periodEnd: string): string {
  const d = new Date(periodEnd + "T00:00:00");
  d.setDate(d.getDate() + 7);
  return formatDateISO(d);
}