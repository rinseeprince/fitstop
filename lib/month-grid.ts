import { addDaysToDateString } from "@/lib/date-helpers";

// A month laid out as a calendar page, for the date pickers. Every date is a
// YYYY-MM-DD string and every step is UTC-anchored, so nothing shifts with the
// browser's timezone.

const DAYS_PER_WEEK = 7;
/** Six weeks hold every month from any weekday, so every page is one height. */
const WEEKS_PER_PAGE = 6;

/** The first of the month a date falls in: "2026-09-23" → "2026-09-01". */
export function monthOf(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** The first of the month `months` away from `month`, in either direction. */
export function shiftMonth(month: string, months: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + months;
  const year = Math.floor(index / 12);
  const monthNumber = index - year * 12 + 1;
  return `${String(year).padStart(4, "0")}-${String(monthNumber).padStart(2, "0")}-01`;
}

/**
 * A month's page, Monday first like the coach calendar's rows: six weeks of
 * seven cells, the month's days in place and null in every cell outside it.
 */
export function monthPage(month: string): (string | null)[] {
  // getUTCDay counts from Sunday; the page starts on Monday.
  const lead = (new Date(`${month}T00:00:00Z`).getUTCDay() + 6) % DAYS_PER_WEEK;
  const next = shiftMonth(month, 1);
  return Array.from({ length: WEEKS_PER_PAGE * DAYS_PER_WEEK }, (_, cell) => {
    const date = addDaysToDateString(month, cell - lead);
    return date >= month && date < next ? date : null;
  });
}
