import type { LoadType, SetSpecMeasure } from "./exercise-set-specs";
import { formatPrescribedLoad } from "./set-spec-rows";
import { formatTargetReadout, type TargetRange } from "./target-range";
import {
  formatDistance,
  formatDuration,
  formatLoad,
  formatPace,
  formatSplit,
  formatZone,
  type UnitSystem,
} from "./unit-conversions";

// How a measure READS — a target range or a logged value with its word, in the
// viewer's units — on every surface that describes a prescription or a log:
// the client's summary line, the coach's readout, the check-in AI's lines.
// One grammar so "5 km", "3:45–3:50 /km", "RPE 7–8" and "250 W" are spelled
// the same everywhere. Ranges take an en dash; the entry grammar (what a box
// takes) is utils/unit-conversions.ts, not this.

/** The unit-bearing measures format each end and share the unit once. */
function joinEnds(
  { min, max }: TargetRange,
  format: (value: number) => string,
): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null) {
    if (min === max) return format(min);
    const [a, b] = [format(min), format(max)];
    const unitAt = (text: string) => text.lastIndexOf(" ");
    const unitA = a.slice(unitAt(a));
    const unitB = b.slice(unitAt(b));
    return unitA === unitB && unitAt(a) > 0
      ? `${a.slice(0, unitAt(a))}–${b.slice(0, unitAt(b))}${unitA}`
      : `${a}–${b}`;
  }
  return min != null ? `${format(min)}+` : `≤${format(max as number)}`;
}

/** A plain number or range followed by its word: "300 kcal", "150–160 bpm". */
function withUnit(range: TargetRange, unit: string): string | null {
  const readout = formatTargetReadout(range);
  return readout == null ? null : `${readout} ${unit}`;
}

/** A word before the number: "RPE 7–8", "cadence 90". */
function withWord(word: string, range: TargetRange): string | null {
  const readout = formatTargetReadout(range);
  return readout == null ? null : `${word} ${readout}`;
}

/**
 * One measure's readout, or null when nothing is prescribed or recorded. A
 * single value is a range whose ends agree; `loadType` is the load's unit,
 * kilograms (converted and snapped, like every read-only load) or a
 * percentage, which never converts.
 */
export function formatMeasureReadout(
  measure: SetSpecMeasure,
  range: TargetRange,
  viewer: UnitSystem,
  loadType: LoadType | null | undefined = null,
): string | null {
  switch (measure) {
    case "reps":
      return formatTargetReadout(range);
    case "load":
      return formatPrescribedLoad(
        { loadType: loadType ?? null, loadMin: range.min, loadMax: range.max },
        (kg) => String(formatLoad(kg, viewer).value),
        formatLoad(0, viewer).unit,
      );
    case "rpe":
      return withWord("RPE", range);
    case "rir":
      return withWord("RIR", range);
    case "distance":
      return joinEnds(range, (metres) => formatDistance(metres, viewer));
    case "duration":
      return joinEnds(range, formatDuration);
    case "pace":
      return joinEnds(range, (seconds) => formatPace(seconds, viewer));
    case "split":
      return joinEnds(range, formatSplit);
    case "calories":
      return withUnit(range, "kcal");
    case "cadence":
      return withWord("cadence", range);
    case "stroke_rate":
      return withUnit(range, "spm");
    case "resistance":
      return withWord("resistance", range);
    case "heart_rate_zone":
      return joinEnds(range, formatZone);
    case "heart_rate":
      return withUnit(range, "bpm");
    case "power":
      return withUnit(range, "W");
    case "ftp_percent": {
      const readout = formatTargetReadout(range);
      return readout == null ? null : `${readout}% FTP`;
    }
  }
}

/** A tempo's readout: the four phases after the word. */
export function formatTempoReadout(tempo: string | null | undefined): string | null {
  return tempo ? `tempo ${tempo}` : null;
}
