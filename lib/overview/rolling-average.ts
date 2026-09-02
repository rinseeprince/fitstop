import { daysBetween } from "@/utils/metric-points";

/**
 * Smoothing and rate for the Overview's progression chart.
 *
 * Both are DISPLAY derivations over a series someone else built — nothing here
 * decides what a measurement is, only how a line is drawn through several of
 * them. The chart is the one net-new component in the Overview redesign, and
 * these two functions are the only new maths it introduces.
 */

export type SeriesPoint = {
  /** YYYY-MM-DD, ascending. */
  date: string;
  value: number;
};

/** The design's line: a 7-day trailing mean. */
const ROLLING_SPAN_DAYS = 7;

/**
 * Trailing mean over a span of CALENDAR DAYS, not of samples.
 *
 * Days, deliberately: a client logging weekly and a client logging daily
 * produce very different sample counts over the same fortnight, and a
 * k-samples mean would smooth them by different amounts — the sparse client's
 * line would lag weeks behind their actual weight. A k-days mean smooths both
 * by the same amount of time, and a sparse series simply averages fewer points
 * (down to one, which is the raw value).
 *
 * Input must be ascending by date; output is the same length, one mean per
 * input point, so the raw dots and the line share an index.
 */
export function rollingAverage(
  points: SeriesPoint[],
  spanDays: number = ROLLING_SPAN_DAYS
): SeriesPoint[] {
  if (points.length === 0) return [];

  const out: SeriesPoint[] = [];
  let start = 0;
  let sum = 0;

  for (let i = 0; i < points.length; i++) {
    sum += points[i].value;
    // Drop everything that fell out of the trailing window. `spanDays` is
    // inclusive of the current day, so a 7-day span keeps a point dated
    // exactly 6 days back.
    while (daysBetween(points[start].date, points[i].date) > spanDays - 1) {
      sum -= points[start].value;
      start++;
    }
    out.push({ date: points[i].date, value: sum / (i - start + 1) });
  }

  return out;
}

/**
 * Change per week across a series, or null when it cannot honestly be stated.
 *
 * The chart passes the SMOOTHED series, so the figure is the trend's slope
 * rather than the distance between two possibly-noisy readings.
 *
 * The divisor is the span the data actually covers, NOT the selected window.
 * A client with three readings in the last fortnight of a 60-day window has a
 * fortnight's rate; dividing that by 60/7 would report a quarter of their real
 * pace, and the coach would read a stall that is not there.
 *
 * The gate matches `deriveHeroStats` (utils/metric-derived-stats.ts): at least
 * two points, at least a week apart. Below that the extrapolated weekly rate is
 * arithmetic, not information — a client who logged twice in two days would
 * post a rate of several kilograms per week.
 */
export function weeklyRate(points: SeriesPoint[]): number | null {
  if (points.length < 2) return null;

  const first = points[0];
  const last = points[points.length - 1];
  const spanDays = daysBetween(first.date, last.date);
  if (spanDays < 7) return null;

  return (last.value - first.value) / (spanDays / 7);
}
