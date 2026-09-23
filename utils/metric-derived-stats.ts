import { getTrend, trendOfChange } from "@/utils/metric-shaping";
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
 * while the start date is ahead. Wellness metrics pass nothing: their Total
 * change is `deriveFirstWeekChange`'s.
 */
type HeroJourney = {
  current: MetricPoint | null;
  baseline: HeroBaseline | null;
  startDate: string | null;
};

/** The Physique hero's Total change: since the start date, against the baseline. */
type SinceStartChange = {
  kind: "sinceStart";
  delta: number;
  sinceDate: string;
  baseline: HeroBaseline;
};

type HeroStats = {
  current: { value: number; date: string; daysAgo: number };
  totalChange: SinceStartChange | null;
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

  const totalChange: HeroStats["totalChange"] =
    journey && !startsAhead && journey.baseline && journey.startDate
      ? {
          kind: "sinceStart",
          delta: latest.value - journey.baseline.value,
          sinceDate: journey.startDate,
          baseline: journey.baseline,
        }
      : null;

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

// ---------------------------------------------------------------------------
// The windows the Journey's cards read (docs/MEASUREMENT-LOG-PLAN.md commit
// 9a): fixed windows of days ending the client's today (D30), so a card keeps
// one label and one window for every client, compares averages and never one
// entry against another, and says how many entries its average stands on.

/** The windows, in days: the last week (card 1, the Wellness hero), the last
 *  30 days (card 2, a wellness score's card 3) and a girth's card 3 (D31). */
export const WINDOW_DAYS = { week: 7, month: 30, girth: 90 } as const;

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * A metric's entries dated inside a window, both ends included: how many, and
 * their average to one decimal — the figure a card shows. No entries, no
 * average.
 */
export type WindowAverage = { average: number | null; count: number };

export function averageInWindow(
  points: readonly MetricPoint[],
  from: string,
  to: string
): WindowAverage {
  const inside = points.filter((p) => p.date >= from && p.date <= to);
  if (inside.length === 0) return { average: null, count: 0 };
  const sum = inside.reduce((total, p) => total + p.value, 0);
  return { average: round1(sum / inside.length), count: inside.length };
}

/** A move between two averages, toned by the metric's good direction. */
export type AverageChange = { amount: number; trend: TrendDirection; tone: Tone };

// Taken between the averages AS SHOWN, so the three figures on a card agree:
// 4.3 against 5.0 reads −0.7, never the −0.8 an unrounded 4.25 would print.
function changeBetween(current: number, previous: number, downIsGood: boolean): AverageChange {
  const amount = round1(current - previous);
  const trend = trendOfChange(amount);
  return { amount, trend, tone: toneFor(trend, downIsGood) };
}

/** The first day of the last `days` days ending `today` — `today` is the last. */
const windowStart = (today: string, days: number): string => addDaysToDate(today, 1 - days);

/** The last `days` days ending the client's today, against the `days` before them. */
export type WindowComparison = {
  days: number;
  current: WindowAverage;
  previous: WindowAverage;
  /** Between the two averages; null unless both windows hold an entry. */
  change: AverageChange | null;
};

export function compareLastDays(
  points: readonly MetricPoint[],
  today: string,
  days: number,
  downIsGood: boolean
): WindowComparison {
  const current = averageInWindow(points, windowStart(today, days), today);
  const previous = averageInWindow(
    points,
    windowStart(today, 2 * days),
    addDaysToDate(today, -days)
  );
  const change =
    current.average != null && previous.average != null
      ? changeBetween(current.average, previous.average, downIsGood)
      : null;
  return { days, current, previous, change };
}

/**
 * The worst entry of the last `days` days — the lowest, the highest where
 * down is good — and the day it was logged; a score reached on several days
 * shows the latest. null when the window holds no entry.
 */
export function worstOfLastDays(
  points: readonly MetricPoint[],
  today: string,
  days: number,
  downIsGood: boolean
): { value: number; date: string } | null {
  const from = windowStart(today, days);
  let worst: MetricPoint | null = null;
  for (const p of points) {
    if (p.date < from || p.date > today) continue;
    // Not strict: the points ascend by date, so a tie moves to the later day.
    if (!worst || (downIsGood ? p.value >= worst.value : p.value <= worst.value)) worst = p;
  }
  return worst ? { value: worst.value, date: worst.date } : null;
}

/**
 * The Wellness hero's Total change (D32): the last 7 days' average against
 * the average of the client's first week of entries — their first entry's day
 * and the 6 after — dated by that first day. Too soon while the two weeks
 * share a day, which they do until the first entry is 13 days old (owner,
 * 2026-09-23); null with no entry at all.
 */
type FirstWeekChange =
  | { kind: "firstWeek"; delta: number; firstWeekOf: string }
  | { kind: "tooSoon" }
  | { kind: "noRecentEntries" };

export function deriveFirstWeekChange(
  points: readonly MetricPoint[],
  today: string
): FirstWeekChange | null {
  if (points.length === 0) return null;
  const firstWeekOf = points[0].date;
  const firstWeekEnd = addDaysToDate(firstWeekOf, WINDOW_DAYS.week - 1);
  const lastWeekStart = windowStart(today, WINDOW_DAYS.week);
  const lastWeek = averageInWindow(points, lastWeekStart, today);
  if (lastWeek.average == null) return { kind: "noRecentEntries" };
  if (firstWeekEnd >= lastWeekStart) return { kind: "tooSoon" };
  const firstWeek = averageInWindow(points, firstWeekOf, firstWeekEnd);
  // Unreachable — the first week holds the first entry — and here for the type.
  if (firstWeek.average == null) return null;
  return { kind: "firstWeek", delta: round1(lastWeek.average - firstWeek.average), firstWeekOf };
}

/** The hero's Total change, per pane: since the start (Physique), since the first week (Wellness). */
export type TotalChange = SinceStartChange | FirstWeekChange;

type DerivedLogRow = {
  id: string;
  date: string;
  metricId: string;
  value: number;
  change: { amount: number; tone: Tone } | null;
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
        defIndex,
        sortKey: point.sortKey,
      });
    });
  });
  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1; // date DESC
    if (a.defIndex !== b.defIndex) return a.defIndex - b.defIndex; // tab order
    return a.sortKey < b.sortKey ? 1 : -1; // the point's own order, newest first
  });
  return rows.map(({ defIndex: _defIndex, sortKey: _sortKey, ...row }) => row);
}
