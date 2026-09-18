import { formatEntry, formatLoad, parseEntry, type UnitSystem } from "./unit-conversions";
import { boxEntry, SET_LOG_MEASURES, type LoggedActuals, type LoggedBox } from "./set-log-measures";
import type { PrescribedRow } from "./set-spec-rows";
import type { TargetRange } from "./target-range";

// Where a logged value sits against the coach's target — the one judgement the
// coach's logged-workout table colours by and the check-in AI's lines name, so
// the two cannot disagree about a set. The owner's rules (2026-09-18): a value
// outside its target — below as well as above — is marked; an RPE two or more
// above the top of its target keeps its red; a % load is never marked, because
// a percentage can't be compared with the kilograms lifted; a tempo that
// differs from the prescribed one is marked.
//
// Judged at the precision both are SHOWN, in the viewer's units, so a value and
// a target that read the same are never outside each other. An imperial client
// who types the "220 lbs" their hint showed has lifted 99.79 kg against a
// 100 kg target, and a run recorded as 5,004 m reads "5 km" beside a "5 km"
// target; marking either would put amber on two numbers that look equal.

export type TargetGap = "above" | "below" | "differs";

/** How far above the top of its target an RPE reads red rather than amber. */
const RPE_WELL_ABOVE = 2;

type NumericBox = Exclude<LoggedBox, "tempo">;

/**
 * A canonical value as its readout shows it, read back: a load in the viewer's
 * unit, snapped like every read-only load; any other measure through its box's
 * own grammar (utils/unit-conversions.ts), so "5.004 km" comes back as the
 * 5,000 m that "5 km" means. Both sides of a comparison go through it.
 */
function shown(box: NumericBox, value: number, viewer: UnitSystem): number {
  if (box === "load") return formatLoad(value, viewer).value;
  const kind = boxEntry(box);
  const read = parseEntry(kind, formatEntry(kind, value, viewer), viewer);
  return typeof read === "number" ? read : value;
}

/** Where `value` falls against a range in the same units: below its floor, above its ceiling, or null inside it. */
export function rangeGap(range: TargetRange, value: number): "above" | "below" | null {
  if (range.min != null && value < range.min) return "below";
  if (range.max != null && value > range.max) return "above";
  return null;
}

/** The range a row targets for a box, or null when it sets none that compares. */
function comparableTarget(box: NumericBox, row: PrescribedRow): TargetRange | null {
  // A percentage of a 1RM or of the top set is not kilograms.
  if (box === "load" && row.loadType !== "absolute") return null;
  const range = row.ranges[box];
  return range.min == null && range.max == null ? null : range;
}

/** One tempo phase as a value: "03" and "3" are the same second, X is explosive. */
function phase(text: string): string {
  return text.toUpperCase() === "X" ? "X" : String(Number(text));
}

/** Two tempos differ when any of their four phases does. Nothing compares with a missing one. */
export function tempoDiffers(target: string | null, actual: string | null): boolean {
  if (!target || !actual) return false;
  const want = target.split("-");
  const did = actual.split("-");
  if (want.length !== did.length) return true;
  return want.some((part, i) => phase(part) !== phase(did[i]));
}

/**
 * Where one set's value for one box sits against its row's target, or null when
 * it is inside it, when either is missing, or when the two can't be compared.
 */
export function boxGap(
  box: LoggedBox,
  row: PrescribedRow | null | undefined,
  actual: LoggedActuals | null | undefined,
  viewer: UnitSystem,
): TargetGap | null {
  if (!row || !actual) return null;
  if (box === "tempo") return tempoDiffers(row.tempo, actual.tempo) ? "differs" : null;
  const value = actual[SET_LOG_MEASURES[box].key];
  const target = comparableTarget(box, row);
  if (value == null || target == null) return null;
  const at = (end: number | null) => (end == null ? null : shown(box, end, viewer));
  return rangeGap({ min: at(target.min), max: at(target.max) }, shown(box, value, viewer));
}

/** An RPE two or more above the top of its target (a single value is its own top). */
export function rpeWellAbove(
  row: PrescribedRow | null | undefined,
  actual: LoggedActuals | null | undefined,
): boolean {
  if (!row || actual?.rpe == null) return false;
  const top = row.ranges.rpe.max ?? row.ranges.rpe.min;
  return top != null && actual.rpe - top >= RPE_WELL_ABOVE;
}

/**
 * The target for the rest the client took after a set (only the React Native
 * app's timer records one): the rest the set prescribes, where the exercise's
 * own rest applies — its Rest column is on and its rows are not a superset's or
 * circuit's rounds, whose rests are the group's. Rest is one number, so any
 * other rest taken is outside it.
 */
export function restTarget(
  row: PrescribedRow | null | undefined,
  ownRestApplies: boolean,
): number | null {
  return ownRestApplies && row ? row.restSeconds : null;
}

export function restGap(target: number | null, taken: number | null): "above" | "below" | null {
  if (target == null || taken == null) return null;
  return rangeGap({ min: target, max: target }, taken);
}
