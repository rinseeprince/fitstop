import type { CheckIn } from "@/types/check-in";
import type { MetricEntry } from "@/types/metric-entries";
import type { DayValue } from "@/lib/measurements/day-values";
import type { MeasurementSource } from "@/lib/measurements/keys";

// Pure series layer for the coach Metrics page. Two producers of the same
// point shape: the measurement log's day-values (the seven PHYSIQUE metrics,
// `dayValuesToMetricPoints`) and the WELLNESS merge of check-in weekly
// averages ⊕ coach-logged client_metric_entries (`buildMetricPoints`, owner
// decision D2: wellness keeps its own model). No date-fns here (same rule as
// utils/metric-shaping.ts): dates are YYYY-MM-DD strings and all math is UTC
// day arithmetic.

export type MetricPoint = {
  metricId: string;
  value: number;
  /** YYYY-MM-DD, the client's calendar day. */
  date: string;
  /** Deterministic total order within a metric: date | source rank | timestamp
   *  | record id. For the wellness merge a coach entry dated D sorts AFTER that
   *  day's check-in average; for the log a day has ONE value already. */
  sortKey: string;
  source: MeasurementSource;
  note: string | null;
  sourceRecordId: string;
};

/**
 * The measurement log's day-values as points — one per day per metric already,
 * so the sort key needs no source rank.
 */
export function dayValuesToMetricPoints(values: readonly DayValue[]): MetricPoint[] {
  return values.map((value) => ({
    metricId: value.metricKey,
    value: value.value,
    date: value.date,
    sortKey: `${value.date}|${value.recordedAt}|${value.id}`,
    source: value.source,
    note: value.note,
    sourceRecordId: value.id,
  }));
}

/** A WELLNESS definition as this merge needs it: the metric id and the CheckIn
 *  field holding its weekly average (dependency-injected so this util stays a
 *  leaf module). A physique metric has no such field — its series is the log's. */
export type MetricSeriesDefinition = {
  id: string;
  key: keyof CheckIn;
};

/**
 * What this merge reads off a check-in: an id, a timestamp, and whichever
 * wellness averages the definitions name. Stated structurally rather than as
 * `CheckIn` so a caller that selected only those columns can pass them; a full
 * `CheckIn` is still assignable, so the Journey passes its rows unchanged.
 */
type MetricSeriesCheckIn = Partial<CheckIn> & Pick<CheckIn, "id" | "createdAt">;

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

export function buildMetricPoints(
  checkIns: MetricSeriesCheckIn[],
  entries: MetricEntry[],
  definitions: MetricSeriesDefinition[]
): Map<string, MetricPoint[]> {
  const byMetric = new Map<string, MetricPoint[]>();

  for (const def of definitions) {
    const series: MetricPoint[] = [];
    for (const ci of checkIns) {
      const raw = ci[def.key];
      if (typeof raw !== "number") continue;
      const date = ci.createdAt.slice(0, 10);
      series.push({
        metricId: def.id,
        value: raw,
        date,
        sortKey: `${date}|1|${ci.createdAt}|${ci.id}`,
        source: "check_in",
        note: null,
        sourceRecordId: ci.id,
      });
    }
    byMetric.set(def.id, series);
  }

  for (const entry of entries) {
    const series = byMetric.get(entry.metricKey);
    if (!series) continue; // unknown key (newer metric than this build) — skip
    series.push({
      metricId: entry.metricKey,
      value: entry.value,
      date: entry.entryDate,
      sortKey: `${entry.entryDate}|2||${entry.id}`,
      source: "coach_entry",
      note: entry.note ?? null,
      sourceRecordId: entry.id,
    });
  }

  for (const series of byMetric.values()) {
    series.sort((a, b) =>
      a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0
    );
  }

  return byMetric;
}
