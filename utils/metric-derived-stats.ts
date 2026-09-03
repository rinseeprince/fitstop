import { getTrend } from "@/utils/metric-shaping";
import {
  addDaysToDate,
  daysBetween,
  type MetricPoint,
} from "@/utils/metric-points";
import type { MeasurementSource } from "@/lib/measurements/keys";
import type { TrendDirection } from "@/types/check-in";

// Deterministic derivations for the coach Metrics page. Every function takes
// the metric's FULL ascending series — the chart's range selector never feeds
// these. For a physique metric that series is the JOURNEY: readings from the
// start date on. No date-fns: formatting happens at render.

export type Tone = "good" | "bad" | "neutral";

export function toneFor(trend: TrendDirection, downIsGood: boolean): Tone {
  if (trend === "stable") return "neutral";
  return (trend === "down") === downIsGood ? "good" : "bad";
}

/** The reading as of the start date — derived by the database, never here. */
export type HeroBaseline = { value: number; date: string; source: MeasurementSource };

/**
 * What a PHYSIQUE hero is anchored on (docs/MEASUREMENT-LOG-PLAN.md D4):
 * "Current" is the newest reading of ANY date and never waits for the start
 * date; every "since start" figure reads the baseline, and reads `Starts …`
 * while the start date is ahead. Wellness metrics pass nothing and keep the
 * first-point anchor, their series being the merged weekly averages.
 */
type HeroJourney = {
  current: MetricPoint | null;
  baseline: HeroBaseline | null;
  startDate: string | null;
};

type HeroStats = {
  current: { value: number; date: string; daysAgo: number };
  totalChange: { delta: number; sinceDate: string; baseline?: HeroBaseline } | null;
  /** The start date while it is still ahead — the since-start cell reads it. */
  startsOn: string | null;
  avgRate: { perWeek: number; weeks: number } | null;
  entries: { count: number; sinceDate: string };
};

export function deriveHeroStats(
  points: MetricPoint[],
  category: "body" | "wellness",
  today: string,
  journey?: HeroJourney
): HeroStats | null {
  const n = points.length;
  const latest = journey ? journey.current : n > 0 ? points[n - 1] : null;
  if (!latest) return null;
  const first = n > 0 ? points[0] : null;
  const last = n > 0 ? points[n - 1] : null;
  const spanDays = first && last ? daysBetween(first.date, last.date) : 0;
  // Weekly-rate gate: wellness scores never rate; body metrics need >= 2
  // entries at least a week apart or the extrapolated weekly rate is absurd.
  const showRate = category === "body" && n >= 2 && spanDays >= 7;
  const startsAhead = journey?.startDate != null && journey.startDate > today;

  let totalChange: HeroStats["totalChange"] = null;
  if (journey) {
    if (!startsAhead && journey.baseline && journey.startDate) {
      totalChange = {
        delta: latest.value - journey.baseline.value,
        sinceDate: journey.startDate,
        baseline: journey.baseline,
      };
    }
  } else if (first && n >= 2) {
    totalChange = { delta: latest.value - first.value, sinceDate: first.date };
  }

  return {
    current: {
      value: latest.value,
      date: latest.date,
      daysAgo: daysBetween(latest.date, today),
    },
    totalChange,
    startsOn: startsAhead ? journey.startDate : null,
    avgRate:
      showRate && first && last
        ? {
            perWeek: (last.value - first.value) / (spanDays / 7),
            weeks: Math.round(spanDays / 7),
          }
        : null,
    entries: { count: n, sinceDate: first?.date ?? latest.date },
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function deriveFrequencyLabel(points: MetricPoint[]): string | null {
  // Duplicate dates collapse: a check-in + a coach entry on one date is one
  // logging day. Median of the most recent <= 12 gaps keeps the label current.
  const dates = [...new Set(points.map((p) => p.date))].sort();
  if (dates.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    gaps.push(daysBetween(dates[i - 1], dates[i]));
  }
  const g = median(gaps.slice(-12));
  if (g <= 1.5) return "daily";
  if (g <= 4.5) return `${Math.min(6, Math.max(2, Math.round(7 / g)))}x/week`;
  if (g <= 10) return "weekly";
  if (g <= 20) return "fortnightly";
  if (g <= 45) return "monthly";
  return "occasional";
}

type WindowChange = {
  kind: "30day" | "sinceFirst";
  delta: number;
  sinceDate?: string;
  trend: TrendDirection;
  tone: Tone;
};

export function deriveWindowChange(
  points: MetricPoint[],
  downIsGood: boolean
): WindowChange | null {
  const n = points.length;
  if (n < 2) return null;
  const latest = points[n - 1];
  // Anchor on the latest entry, not today: the card means "change over the
  // ~30 days ending at the last measurement", which stays meaningful when a
  // client stops logging.
  const target = addDaysToDate(latest.date, -30);
  if (points[0].date > target) {
    const trend = getTrend(latest.value, points[0].value);
    return {
      kind: "sinceFirst",
      delta: latest.value - points[0].value,
      sinceDate: points[0].date,
      trend,
      tone: toneFor(trend, downIsGood),
    };
  }
  let baseline = points[0];
  let bestDist = Math.abs(daysBetween(baseline.date, target));
  for (let i = 1; i < n - 1; i++) {
    const dist = Math.abs(daysBetween(points[i].date, target));
    // strictly-less keeps the EARLIER point on equidistant ties
    if (dist < bestDist) {
      baseline = points[i];
      bestDist = dist;
    }
  }
  const trend = getTrend(latest.value, baseline.value);
  return {
    kind: "30day",
    delta: latest.value - baseline.value,
    trend,
    tone: toneFor(trend, downIsGood),
  };
}

type WeekComparison =
  | { kind: "weekAvg"; currentAvg: number; prevAvg: number }
  | { kind: "latest"; value: number; date: string };

function mean(points: MetricPoint[]): number {
  return points.reduce((sum, p) => sum + p.value, 0) / points.length;
}

export function deriveWeekComparison(
  points: MetricPoint[],
  today: string
): WeekComparison | null {
  const n = points.length;
  if (n === 0) return null;
  const curStart = addDaysToDate(today, -6);
  const prevStart = addDaysToDate(today, -13);
  const prevEnd = addDaysToDate(today, -7);
  const cur = points.filter((p) => p.date >= curStart && p.date <= today);
  const prev = points.filter((p) => p.date >= prevStart && p.date <= prevEnd);
  if (cur.length >= 1 && prev.length >= 1) {
    return { kind: "weekAvg", currentAvg: mean(cur), prevAvg: mean(prev) };
  }
  const latest = points[n - 1];
  return { kind: "latest", value: latest.value, date: latest.date };
}

export function deriveBest(
  points: MetricPoint[],
  downIsGood: boolean
): { value: number; date: string } | null {
  if (points.length === 0) return null;
  let best = points[0];
  for (const p of points) {
    // strict improvement only — a record is set the FIRST time it is reached
    if (downIsGood ? p.value < best.value : p.value > best.value) best = p;
  }
  return { value: best.value, date: best.date };
}

type DerivedLogRow = {
  id: string;
  date: string;
  metricId: string;
  value: number;
  change: { amount: number; tone: Tone } | null;
  note: string | null;
  source: MetricPoint["source"];
};

/** The metric ids a pane lists, in tab order — the subset of a definition the
 *  log rows need. */
export type LogRowDefinition = { id: string; category: "body" | "wellness" };

export function buildLogRows(
  pointsByMetric: Map<string, MetricPoint[]>,
  definitions: LogRowDefinition[],
  category: "body" | "wellness",
  downIsGood: ReadonlySet<string>
): DerivedLogRow[] {
  const rows: Array<DerivedLogRow & { defIndex: number; sortKey: string }> = [];
  definitions.forEach((def, defIndex) => {
    if (def.category !== category) return;
    const series = pointsByMetric.get(def.id) ?? [];
    series.forEach((point, i) => {
      const prev = i > 0 ? series[i - 1] : null;
      const trend = getTrend(point.value, prev?.value ?? null);
      rows.push({
        id: `${def.id}|${point.sortKey}`,
        date: point.date,
        metricId: def.id,
        value: point.value,
        change: prev
          ? {
              amount: point.value - prev.value,
              tone: toneFor(trend, downIsGood.has(def.id)),
            }
          : null,
        note: point.source === "coach_entry" ? point.note : null,
        source: point.source,
        defIndex,
        sortKey: point.sortKey,
      });
    });
  });
  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1; // date DESC
    if (a.defIndex !== b.defIndex) return a.defIndex - b.defIndex; // tab order
    return a.sortKey < b.sortKey ? 1 : -1; // within a day, newest source last-in first
  });
  return rows.map(({ defIndex: _defIndex, sortKey: _sortKey, ...row }) => row);
}
