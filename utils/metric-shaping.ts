import type { TrendDirection } from "@/types/check-in";

// Pure, locale-neutral metric helpers shared by the server-side progress shaper
// (services/client-portal-progress.ts) and the coach-side metrics hook
// (components/clients/metrics/hooks/use-metrics-data.ts). NO date-fns here:
// formatting happens at render, these only do numeric comparison/math.

export function getTrend(
  current: number | null,
  previous: number | null,
): TrendDirection {
  if (current === null || previous === null) return "stable";
  const diff = current - previous;
  if (Math.abs(diff) < 0.5) return "stable";
  return diff > 0 ? "up" : "down";
}

export function calculatePercentChange(
  current: number | null,
  previous: number | null,
): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}
