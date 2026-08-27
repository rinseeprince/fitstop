/**
 * The client Overview's single global window control.
 *
 * One window governs the progression chart and the Signals card (including
 * their expanded detail). It deliberately does NOT govern the structural
 * facts around them — goal targets, BMR/TDEE, the deadline, plan name/week,
 * the next check-in — which describe a client rather than a period.
 *
 * `60` is the ceiling because the adherence read is unpaged: five selects with
 * no cursor, one of them `daily_habit_logs` (habits x days). At 60 days that
 * cannot approach PostgREST's row cap; at "all time" it silently could, and a
 * truncated rail reads as a client who stopped logging. Raise this only
 * alongside paging that read.
 */

export const OVERVIEW_WINDOWS = [30, 60] as const;

export type OverviewWindow = (typeof OVERVIEW_WINDOWS)[number];

export const DEFAULT_OVERVIEW_WINDOW: OverviewWindow = 30;

/** Divider-rail meta. Number-bearing, so the call site renders it mono. */
export function overviewWindowLabel(days: OverviewWindow): string {
  return `Last ${days} days`;
}

export function isOverviewWindow(value: number): value is OverviewWindow {
  return (OVERVIEW_WINDOWS as readonly number[]).includes(value);
}
