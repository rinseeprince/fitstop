import type { TrendDirection } from "@/types/check-in";

// Pure, locale-neutral metric helpers shared by the server-side progress shaper
// (services/client-portal-progress.ts) and the coach-side metrics hook
// (components/clients/metrics/hooks/use-metrics-data.ts). NO date-fns here:
// formatting happens at render, these only do numeric comparison/math.

/**
 * The direction of a change AS THE READER SEES IT: rounded to one decimal, the
 * precision every surface prints, and "stable" only when that rounds to nothing.
 * A cut-off wider than the printed step (this used to be 0.5, written for
 * kilograms and applied to 1-5 and 1-10 wellness scores) shows "+0.4" in the
 * colour of "no change".
 */
export function trendOfChange(change: number): TrendDirection {
  const rounded = Number(change.toFixed(1));
  if (rounded === 0) return "stable";
  return rounded > 0 ? "up" : "down";
}

export function getTrend(
  current: number | null,
  previous: number | null,
): TrendDirection {
  if (current === null || previous === null) return "stable";
  return trendOfChange(current - previous);
}

export function calculatePercentChange(
  current: number | null,
  previous: number | null,
): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}
