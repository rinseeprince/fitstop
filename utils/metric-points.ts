import type { DayValue } from "@/lib/measurements/day-values";

// Pure series layer: the point shape a metric's chart and figures read, one
// per day, and `dayValuesToMetricPoints`, which makes points from the
// measurement log's day-values (the client journey's weight series). No
// date-fns here (same rule as utils/metric-shaping.ts): dates are YYYY-MM-DD
// strings and all math is UTC day arithmetic.

export type MetricPoint = {
  metricId: string;
  value: number;
  /** YYYY-MM-DD, the client's calendar day. */
  date: string;
  /** Deterministic total order within a metric: date | timestamp | record id —
   *  a day holds ONE value already. */
  sortKey: string;
  sourceRecordId: string;
};

/** The measurement log's day-values as points — one per day per metric already. */
export function dayValuesToMetricPoints(values: readonly DayValue[]): MetricPoint[] {
  return values.map((value) => ({
    metricId: value.metricKey,
    value: value.value,
    date: value.date,
    sortKey: `${value.date}|${value.recordedAt}|${value.id}`,
    sourceRecordId: value.id,
  }));
}

/** UTC-midnight epoch ms for a YYYY-MM-DD string — the numeric form of a
 *  calendar day (the metric chart's time axis runs on these). */
export function toUtcMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / 86_400_000);
}

export function addDaysToDate(date: string, days: number): string {
  return new Date(toUtcMs(date) + days * 86_400_000).toISOString().slice(0, 10);
}
