import type { NutritionEvent } from "@/types/check-in";

/**
 * Coach calendar selection helpers (Session 4 ◆2). A nutrition day is editable
 * (selectable) only when it is today-forward AND carries a scheduled event —
 * the client-side mirror of the server's per-element `date >= clientToday` +
 * `status = 'scheduled'` guards in materializeNutritionEventDays. Pure functions
 * so the eligibility rules are unit-testable away from React.
 */

export function isDateEligible(
  date: string,
  eventsByDate: Map<string, NutritionEvent>,
  clientToday: string
): boolean {
  if (date < clientToday) return false;
  const event = eventsByDate.get(date);
  return !!event && event.status === "scheduled";
}

/** Eligible subset of an arbitrary date list, original order preserved. */
export function eligibleDatesIn(
  dates: string[],
  eventsByDate: Map<string, NutritionEvent>,
  clientToday: string
): string[] {
  return dates.filter((d) => isDateEligible(d, eventsByDate, clientToday));
}

/** Eligible IN-month days of the viewed month whose event matches `pred`
 * (outside-month grid cells excluded). Backs the selection-bar quick groups. */
export function monthDatesWhere(
  weeks: string[][],
  viewMonth: number,
  viewYear: number,
  eventsByDate: Map<string, NutritionEvent>,
  clientToday: string,
  pred: (event: NutritionEvent) => boolean
): string[] {
  const out: string[] = [];
  for (const week of weeks) {
    for (const date of week) {
      const d = new Date(date + "T00:00:00");
      if (d.getMonth() !== viewMonth || d.getFullYear() !== viewYear) continue;
      if (!isDateEligible(date, eventsByDate, clientToday)) continue;
      const event = eventsByDate.get(date);
      if (event && pred(event)) out.push(date);
    }
  }
  return out;
}

/** Eligible IN-month days of the viewed month (outside-month grid cells excluded). */
export function thisMonthDates(
  weeks: string[][],
  viewMonth: number,
  viewYear: number,
  eventsByDate: Map<string, NutritionEvent>,
  clientToday: string
): string[] {
  return monthDatesWhere(weeks, viewMonth, viewYear, eventsByDate, clientToday, () => true);
}

/** The week (of `weeks`) that contains clientToday, or null if it isn't shown. */
export function weekContaining(
  weeks: string[][],
  clientToday: string
): string[] | null {
  return weeks.find((w) => w.includes(clientToday)) ?? null;
}
