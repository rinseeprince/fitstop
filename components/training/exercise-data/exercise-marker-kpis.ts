import type { ExerciseProgressionPoint } from "@/types/training";
import type { ProgressMarkerSpec } from "@/utils/exercise-progress-markers";
import {
  formatMarkerDelta,
  formatMarkerNumber,
  formatMarkerValue,
  markerSeriesValue,
} from "@/utils/exercise-marker-format";
import type { UnitSystem } from "@/utils/unit-conversions";

// The KPI strip's cards for any chart marker that isn't one of Strength's own
// five (those keep their worded cards in exercise-insight.ts): Latest, the
// best in the window by the marker's own word, and the change from the first
// session to the latest — every number in the viewer's units.

export type KpiCard = {
  label: string;
  value: string;
  unit?: string;
  meta?: string;
  trend?: "up" | "down" | "flat";
};

/** "Today", "1 day ago", "12 days ago" — how long since a best was set. */
export function daysAgoText(iso: string, now: number = Date.now()): string {
  const days = Math.floor((now - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "Today";
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function markerKpis(
  spec: ProgressMarkerSpec,
  data: ExerciseProgressionPoint[],
  viewer: UnitSystem,
): KpiCard[] {
  const series = data.flatMap((p) => {
    const value = p[spec.value];
    return value == null ? [] : [{ date: p.date, value: markerSeriesValue(spec.readout, value, viewer) }];
  });
  if (series.length === 0) return [];

  const latest = series[series.length - 1];
  const first = series[0];
  // The best in the window; on a tie the most recent session, like Last PR
  const better = spec.better ?? "higher";
  let best = series[0];
  for (const s of series) {
    if (better === "higher" ? s.value >= best.value : s.value <= best.value) best = s;
  }
  const { unit } = formatMarkerValue(spec.readout, 0, viewer);
  // The change is taken BETWEEN the displayed values, so the card equals the
  // difference of the two numbers a coach can see
  const delta = latest.value - first.value;

  return [
    {
      label: "Latest",
      value: formatMarkerNumber(spec.readout, latest.value),
      unit: unit || undefined,
    },
    {
      label: spec.bestLabel,
      value: formatMarkerNumber(spec.readout, best.value),
      unit: unit || undefined,
      meta: daysAgoText(best.date),
    },
    {
      label: "Change",
      value: series.length < 2 ? "-" : formatMarkerDelta(spec.readout, delta),
      unit: series.length < 2 ? undefined : unit || undefined,
      trend: series.length < 2 ? undefined : delta > 0 ? "up" : delta < 0 ? "down" : "flat",
    },
  ];
}
