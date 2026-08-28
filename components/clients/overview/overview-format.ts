import {
  addDaysToDateString,
  dateStringToDayNumber,
  getDateString,
  getTodayDateString,
  getTodayDateStringInTimezone,
} from "@/lib/date-helpers";

// Render-side formatting for the coach Overview.
//
// Two date families, deliberately parsed differently:
//   * timestamps (`at`, `createdAt`) are full ISO strings → `new Date(iso)`
//   * calendar dates (`nextSession.date`, adherence `dates[]`) are YYYY-MM-DD →
//     `new Date(str + "T00:00:00")`, the platform's local-parse convention
//     (lib/date-helpers.ts). Bare `new Date("2026-07-31")` parses as UTC
//     midnight and renders the previous day west of Greenwich.

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Compact feed timestamp: "1m ago" · "3h ago" · "2d ago" · "5w ago".
 * Every branch is number-bearing on purpose, so the call site can be mono
 * unconditionally instead of switching fonts mid-column.
 */
export function formatRelativeShort(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  const diff = Math.max(0, now.getTime() - then);
  if (diff < HOUR_MS) return `${Math.max(1, Math.floor(diff / MINUTE_MS))}m ago`;
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)}h ago`;

  const days = Math.floor(diff / DAY_MS);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

/**
 * Calendar-day distance as a phrase, with the font decision attached:
 * "today" / "yesterday" are word-only (sans), "3 days ago" is number-bearing
 * (mono). Mirrors the metric hero's SUB_SANS/SUB_MONO split.
 */
export function relativeDayPhrase(
  iso: string,
  now: Date = new Date()
): { text: string; isNumeric: boolean } | null {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;

  const days =
    dateStringToDayNumber(getDateString(now)) - dateStringToDayNumber(getDateString(then));

  if (days <= 0) return { text: "today", isNumeric: false };
  if (days === 1) return { text: "yesterday", isNumeric: false };
  return { text: `${days} days ago`, isNumeric: true };
}

/** "31 Jul" from a YYYY-MM-DD calendar date. */
export function formatDateOnlyShort(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
  });
}

/** "Fri, 31 Jul" from a YYYY-MM-DD calendar date. */
export function formatDateOnlyWeekday(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/**
 * How long is left to hit a goal deadline, with the font decision attached.
 *
 * Anchored on the CLIENT's local midnight, the same anchor
 * `comparison-service.ts:102-108` uses for its pace figures. A device-day
 * version disagrees with the check-in chip by a day for any client in another
 * zone — two readouts on one page describing the same calendar differently.
 *
 * Whole weeks are FLOORED, so "8 weeks left" means at least eight full weeks
 * rather than a rounded-up seven and a half. Under a week the phrase drops to
 * days, because "0 weeks left" is not what a coach means by three days.
 */
export function deadlineRemaining(
  deadline: string,
  timezone: string
): { text: string; isNumeric: boolean } {
  const days =
    dateStringToDayNumber(deadline) -
    dateStringToDayNumber(getTodayDateStringInTimezone(timezone));

  if (days < 0) return { text: "Deadline passed", isNumeric: false };
  if (days === 0) return { text: "Due today", isNumeric: false };
  if (days < 7) return { text: `${pluralize(days, "day")} left`, isNumeric: true };
  return { text: `${pluralize(Math.floor(days / 7), "week")} left`, isNumeric: true };
}

/** Single-letter weekday for a dot rail's column label. */
export function formatDayInitial(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-AU", { weekday: "narrow" });
}

/**
 * "82.4 kg" / "18%" / "4/5" — scale suffixes and percent hug the numeral,
 * real units take a space.
 */
export function formatMetricValue(value: number, unit: string): string {
  const rendered = Number.isInteger(value) ? String(value) : value.toFixed(1);
  if (!unit) return rendered;
  if (unit.startsWith("/") || unit === "%") return `${rendered}${unit}`;
  return `${rendered} ${unit}`;
}

/**
 * The trailing `days` calendar dates ending on today, oldest → newest.
 * Device-local, matching the daily-logs window the coach surfaces already read.
 */
export function trailingDates(days: number, endDate: string = getTodayDateString()): string[] {
  return Array.from({ length: days }, (_, i) => addDaysToDateString(endDate, i - (days - 1)));
}

/** "1 session" / "3 sessions" — count plus its noun, mono at the call site. */
export function pluralize(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}
