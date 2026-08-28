import type { CheckIn } from "@/types/check-in";
import type { MetricEntry } from "@/types/metric-entries";

// Pure merge layer for the coach Metrics page: check-in-derived values +
// coach-logged client_metric_entries become one ascending series per metric.
// No date-fns here (same rule as utils/metric-shaping.ts): dates are
// YYYY-MM-DD strings and all math is UTC day arithmetic.

type MetricPointSource = "check_in" | "coach_entry";

export type MetricPoint = {
  metricId: string;
  value: number;
  /** YYYY-MM-DD. Check-ins use createdAt's date part (the page's existing
   *  window-filter convention); coach entries use entry_date. */
  date: string;
  /** Deterministic total order: date | source rank | timestamp | record id.
   *  A coach entry dated D sorts AFTER that day's check-ins — the coach's
   *  explicit entry wins ties for latest/previous and per-row deltas,
   *  consistent with the current-weight cache rule in the entries service. */
  sortKey: string;
  source: MetricPointSource;
  note: string | null;
  sourceRecordId: string;
};

/** Structural subset of a METRIC_DEFINITIONS entry (dependency-injected so
 *  this util stays a leaf module). */
export type MetricSeriesDefinition = {
  id: string;
  key: keyof CheckIn;
  category: "body" | "wellness";
};

/**
 * What this merge actually reads off a check-in: an id, a timestamp, and
 * whichever metric columns the definitions name.
 *
 * Stated structurally rather than as `CheckIn` so a caller that selected four
 * columns can pass four columns. The Overview's measurement-series route reads
 * `id, created_at, weight, body_fat_percentage` — against a 37-column table
 * carrying four JSON blobs — and the alternative was inventing a `status` and
 * an `updatedAt` it never fetched, purely to satisfy a type. A full `CheckIn`
 * is still assignable, so the Metrics page passes its rows unchanged.
 */
export type MetricSeriesCheckIn = Partial<CheckIn> & Pick<CheckIn, "id" | "createdAt">;

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
