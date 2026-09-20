import type { MarkerReadout } from "./exercise-progress-markers";
import {
  formatDuration,
  formatLoad,
  METERS_PER_MILE,
  type UnitSystem,
} from "./unit-conversions";

// How a chart marker's numbers read on the chart's axis, its subtitle and the
// KPI strip — in the viewer's units (CONVENTIONS section 20), with the
// time-like readouts as clocks. The tooltip and the PR cards use the readout
// grammar (utils/unit-conversions.ts) directly, since they read one value with
// its unit; these are for series of numbers that share one unit.

const round2 = (n: number): number => Math.round(n * 100) / 100;

const isClock = (readout: MarkerReadout): boolean =>
  readout === "pace" || readout === "split" || readout === "duration";

/**
 * The number a chart plots for a canonical value: a load or a distance in the
 * viewer's unit, a pace per the viewer's unit, everything else as stored. A
 * load is read-only here, so it snaps like every read-only load.
 */
export function markerSeriesValue(
  readout: MarkerReadout,
  value: number,
  viewer: UnitSystem,
): number {
  switch (readout) {
    case "load":
      return formatLoad(value, viewer).value;
    case "distance":
      return round2(viewer === "imperial" ? value / METERS_PER_MILE : value / 1000);
    case "pace":
      return viewer === "imperial"
        ? Math.round((value * METERS_PER_MILE) / 1000)
        : Math.round(value);
    default:
      return value;
  }
}

/** The word beside a marker's numbers on the chart's subtitle; empty where the header says it all. */
export function markerUnit(readout: MarkerReadout, viewer: UnitSystem): string {
  switch (readout) {
    case "load":
      return formatLoad(0, viewer).unit;
    case "distance":
      return viewer === "imperial" ? "mi" : "km";
    case "pace":
      return viewer === "imperial" ? "/mi" : "/km";
    case "split":
      return "/500m";
    case "duration":
      return "m:ss";
    case "watts":
      return "W";
    case "reps":
      return "reps";
    case "sets":
      return "sets";
    case "rpe":
      return "";
  }
}

/** A plotted number read back: a clock for the time-like readouts, the number otherwise. */
export function formatMarkerNumber(readout: MarkerReadout, seriesValue: number): string {
  return isClock(readout) ? formatDuration(seriesValue) : String(round2(seriesValue));
}

/** A KPI value: the display number and the unit that sits beside it (none beside a duration). */
export function formatMarkerValue(
  readout: MarkerReadout,
  value: number,
  viewer: UnitSystem,
): { value: string; unit: string } {
  return {
    value: formatMarkerNumber(readout, markerSeriesValue(readout, value, viewer)),
    unit: readout === "duration" ? "" : markerUnit(readout, viewer),
  };
}

/** A signed change between two plotted values: "+5", "-0:15", "+1.2". */
export function formatMarkerDelta(readout: MarkerReadout, delta: number): string {
  const sign = delta > 0 ? "+" : delta < 0 ? "-" : "";
  return `${sign}${formatMarkerNumber(readout, Math.abs(delta))}`;
}
