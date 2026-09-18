import type { LoadType, SetSpecMeasure } from "./exercise-set-specs";
import {
  BOX_LABELS,
  boxEntry,
  SET_LOG_MEASURES,
  type LoggedActuals,
  type LoggedBox,
} from "./set-log-measures";
import { formatPrescribedLoad, type PrescribedRow } from "./set-spec-rows";
import { formatTargetReadout, type TargetRange } from "./target-range";
import {
  formatDistance,
  formatDuration,
  formatEntry,
  formatLoad,
  formatPace,
  formatSplit,
  formatZone,
  type UnitSystem,
} from "./unit-conversions";

// How a measure READS — a target range or a logged value with its word, in the
// viewer's units — on every surface that describes a prescription or a log:
// the client's summary line and boxes, the coach's logged-workout table, the
// check-in AI's lines. One grammar so "5 km", "3:45–3:50 /km", "RPE 7–8" and
// "250 W" are spelled the same everywhere. Ranges take an en dash; the entry
// grammar (what a box takes) is utils/unit-conversions.ts, not this.

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

/**
 * A box's column header, in the client's grid and the coach's table alike. Load
 * names the unit its bare values are in; every other box's value carries its
 * own unit or has none.
 */
export function boxHeader(box: LoggedBox, viewer: UnitSystem): string {
  return box === "load" ? `${BOX_LABELS.load} (${formatLoad(0, viewer).unit})` : BOX_LABELS[box];
}

/**
 * The coach's target for one box of one row: the client's box hints it, and the
 * coach's table reads it over what was done. A range reads with an en dash
 * ("7–8", "100–105 kg", "3:45–3:50 /km"); a box whose header carries its word
 * (reps, RPE, RIR, cadence, resistance) reads the bare number, and a
 * unit-bearing measure reads with its unit. Null when the row sets none.
 */
export function formatBoxTarget(
  box: LoggedBox,
  row: PrescribedRow | null | undefined,
  viewer: UnitSystem,
): string | null {
  if (!row) return null;
  const target = (() => {
    switch (box) {
      case "tempo":
        return row.tempo;
      case "reps":
        return row.repsTarget ?? formatTargetReadout(row.ranges.reps);
      case "rpe":
      case "rir":
      case "cadence":
      case "resistance":
        return formatTargetReadout(row.ranges[box]);
      case "load":
        return formatMeasureReadout("load", row.ranges.load, viewer, row.loadType);
      default:
        return formatMeasureReadout(box, row.ranges[box], viewer);
    }
  })();
  return target || null;
}

/**
 * What a set recorded in one box, in the viewer's units: the box's own readback
 * ("5.02 km", "26:10", "4:58 /km", "Z3", a bare number — `formatEntry`, what the
 * client's box showed when they left it), and a load as a bare number in the
 * viewer's unit, snapped like every read-only load. Null when nothing was
 * recorded there.
 */
export function formatBoxActual(
  box: LoggedBox,
  actual: LoggedActuals | null | undefined,
  viewer: UnitSystem,
): string | null {
  if (!actual) return null;
  if (box === "tempo") return actual.tempo;
  const value = actual[SET_LOG_MEASURES[box].key];
  if (value == null) return null;
  if (box === "load") return String(formatLoad(value, viewer).value);
  return formatEntry(boxEntry(box), value, viewer);
}
