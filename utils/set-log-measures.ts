import { LOAD_KG_MAX } from "@/lib/constants";
import type { SetLogInsert, SetLogRow } from "@/lib/database-helpers";
import { TEMPO_PATTERN, type SetSpecMeasure } from "./exercise-set-specs";
import { PRESCRIBED_FIELDS, type PrescribedField } from "./prescribed-fields";
import { toCanonicalWeightKg, type EntryKind } from "./unit-conversions";

// The one table of a logged set's ACTUALS (migration 184) — the sibling of
// SET_SPEC_MEASURES, the one table of its targets. Every column a coach can
// prescribe has its actual on the logged set, in the same measure and within
// the same limit, as a real column: the migration's CHECKs, the wire schema
// (lib/validations/training.ts), the log writer and row mapper
// (services/training-log-service.ts), the client's boxes and the coach's
// readout all derive from this table, so no layer can carry a bound the others
// don't. utils/set-log-measures.test.ts reads the migration and fails if a
// bound, a type or a scale differs.
//
// Keyed by the prescribed column (utils/prescribed-fields.ts), because that is
// how a screen walks an exercise: `load`'s actual is the kilograms lifted
// (column `weight`, wire key `weight`, as before this table existed), and
// `rest`'s actual is the rest the client actually took, which only the React
// Native app's timer records. `set_type` has no actual of its own — it is
// stamped from the prescription (set_logs.set_type) — and `tempo` is the one
// non-numeric actual, kept beside the table as SET_LOG_TEMPO.

/** One numeric actual: where it lives, how it is bounded, and how it is typed. */
type NumericActual<Key extends string, Column extends keyof SetLogRow> = {
  /** The wire key AND the camelCase field on SetLog / the form's seeds. */
  key: Key;
  /** The set_logs column. */
  column: Column;
  floor: number;
  ceiling: number;
  integer: boolean;
  /** Decimal places the column stores; the validator refuses a finer value. */
  scale: number;
  /** The target it is compared with, or null for rest, which has no target measure. */
  target: SetSpecMeasure | null;
  /** The grammar a box uses to type and read it (utils/unit-conversions.ts). */
  entry: Exclude<EntryKind, "tempo">;
};

function actual<Key extends string, Column extends keyof SetLogRow>(
  spec: NumericActual<Key, Column>,
): NumericActual<Key, Column> {
  return spec;
}

/**
 * Bounds are the owner's limits, "targets and actuals alike"
 * (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md section 4.4). Reps and load are "as
 * today": a logged rep count keeps migration 090's floor of 1, where a target
 * may be 0. The test pins every other bound to its target's.
 */
export const SET_LOG_MEASURES = {
  load: actual({ key: "weight", column: "weight", floor: 0, ceiling: LOAD_KG_MAX, integer: false, scale: 2, target: "load", entry: "load" }),
  reps: actual({ key: "reps", column: "reps", floor: 1, ceiling: 100, integer: true, scale: 0, target: "reps", entry: "number" }),
  rpe: actual({ key: "rpe", column: "rpe", floor: 1, ceiling: 10, integer: false, scale: 1, target: "rpe", entry: "number" }),
  rir: actual({ key: "rir", column: "rir", floor: 0, ceiling: 10, integer: false, scale: 1, target: "rir", entry: "number" }),
  distance: actual({ key: "distanceMeters", column: "distance_meters", floor: 1, ceiling: 1_000_000, integer: false, scale: 2, target: "distance", entry: "distance" }),
  duration: actual({ key: "durationSeconds", column: "duration_seconds", floor: 0.1, ceiling: 86_400, integer: false, scale: 1, target: "duration", entry: "duration" }),
  pace: actual({ key: "paceSecondsPerKm", column: "pace_seconds_per_km", floor: 60, ceiling: 3_600, integer: true, scale: 0, target: "pace", entry: "pace" }),
  split: actual({ key: "splitSecondsPer500m", column: "split_seconds_per_500m", floor: 30, ceiling: 600, integer: false, scale: 1, target: "split", entry: "split" }),
  calories: actual({ key: "calories", column: "calories", floor: 1, ceiling: 5_000, integer: true, scale: 0, target: "calories", entry: "number" }),
  cadence: actual({ key: "cadence", column: "cadence", floor: 1, ceiling: 300, integer: true, scale: 0, target: "cadence", entry: "number" }),
  stroke_rate: actual({ key: "strokeRate", column: "stroke_rate", floor: 1, ceiling: 150, integer: true, scale: 0, target: "stroke_rate", entry: "number" }),
  resistance: actual({ key: "resistance", column: "resistance", floor: 0, ceiling: 100, integer: false, scale: 1, target: "resistance", entry: "number" }),
  heart_rate_zone: actual({ key: "heartRateZone", column: "heart_rate_zone", floor: 1, ceiling: 5, integer: true, scale: 0, target: "heart_rate_zone", entry: "zone" }),
  heart_rate: actual({ key: "heartRate", column: "heart_rate", floor: 30, ceiling: 250, integer: true, scale: 0, target: "heart_rate", entry: "number" }),
  power: actual({ key: "power", column: "power", floor: 1, ceiling: 3_000, integer: true, scale: 0, target: "power", entry: "number" }),
  ftp_percent: actual({ key: "ftpPercent", column: "ftp_percent", floor: 1, ceiling: 300, integer: false, scale: 1, target: "ftp_percent", entry: "number" }),
  rest: actual({ key: "restSeconds", column: "rest_seconds", floor: 0, ceiling: 3_600, integer: true, scale: 0, target: null, entry: "number" }),
} as const;

/** The one non-numeric actual: the tempo used, on the four-phase grammar. */
export const SET_LOG_TEMPO = { key: "tempo", column: "tempo", pattern: TEMPO_PATTERN } as const;

export type LoggedMeasure = keyof typeof SET_LOG_MEASURES;
/** The numeric measures, in the columns' own order. */
export const LOGGED_MEASURES = Object.keys(SET_LOG_MEASURES) as LoggedMeasure[];

type Measures = typeof SET_LOG_MEASURES;
/** A numeric actual's wire key and SetLog field. */
export type ActualNumberKey = Measures[LoggedMeasure]["key"];
export type ActualKey = ActualNumberKey | "tempo";

/**
 * Every actual a set can carry, keyed by wire key — the shape on `SetLog`, on
 * the wire once parsed, and behind the form's untouched-box guard. Null is
 * "not recorded".
 */
export type LoggedActuals = {
  [M in LoggedMeasure as Measures[M]["key"]]: number | null;
} & { tempo: string | null };

/** The columns a client types into: every prescribed column but the two that aren't boxes. */
export type LoggedBox = Exclude<PrescribedField, "set_type" | "rest">;

/** The seventeen boxes, in the prescribed columns' order. */
export const LOGGED_BOXES: readonly LoggedBox[] = PRESCRIBED_FIELDS.filter(
  (field): field is LoggedBox => field !== "set_type" && field !== "rest",
);

/** An exercise's boxes: its prescribed columns that are boxes, in the columns' order. */
export function loggedBoxesFor(fields: ReadonlySet<PrescribedField>): LoggedBox[] {
  return LOGGED_BOXES.filter((box) => fields.has(box));
}

export function boxKey(box: LoggedBox): ActualKey {
  return box === "tempo" ? SET_LOG_TEMPO.key : SET_LOG_MEASURES[box].key;
}

export function boxEntry(box: LoggedBox): EntryKind {
  return box === "tempo" ? "tempo" : SET_LOG_MEASURES[box].entry;
}

/** The header over a box in the client's grid and the coach's table; Load carries the viewer's unit. */
export const BOX_LABELS: Record<LoggedBox, string> = {
  load: "Load",
  reps: "Reps",
  rpe: "RPE",
  rir: "RIR",
  tempo: "Tempo",
  distance: "Distance",
  duration: "Duration",
  pace: "Pace",
  split: "Split",
  calories: "Calories",
  cadence: "Cadence",
  stroke_rate: "Stroke rate",
  resistance: "Resistance",
  heart_rate_zone: "HR zone",
  heart_rate: "Heart rate",
  power: "Power",
  ftp_percent: "% FTP",
};

/** The word after "Set 1" in a box's accessible name — "Set 1 weight", "Set 1 pace". */
export const BOX_WORDS: Record<LoggedBox, string> = {
  load: "weight",
  reps: "reps",
  rpe: "RPE",
  rir: "RIR",
  tempo: "tempo",
  distance: "distance",
  duration: "duration",
  pace: "pace",
  split: "split",
  calories: "calories",
  cadence: "cadence",
  stroke_rate: "stroke rate",
  resistance: "resistance",
  heart_rate_zone: "HR zone",
  heart_rate: "heart rate",
  power: "power",
  ftp_percent: "% FTP",
};

export function emptyLoggedActuals(): LoggedActuals {
  const out: Record<string, number | string | null> = { tempo: null };
  for (const measure of LOGGED_MEASURES) out[SET_LOG_MEASURES[measure].key] = null;
  return out as LoggedActuals;
}

/** The actuals held by anything carrying their keys — a SetLog, a parsed set, a form seed. */
export function pickLoggedActuals(
  source: Partial<Record<ActualKey, number | string | null | undefined>>,
): LoggedActuals {
  const out = emptyLoggedActuals();
  const bag = out as Record<string, number | string | null>;
  for (const measure of LOGGED_MEASURES) {
    const { key } = SET_LOG_MEASURES[measure];
    const value = source[key];
    bag[key] = typeof value === "number" ? value : null;
  }
  out.tempo = typeof source.tempo === "string" ? source.tempo : null;
  return out;
}

/** A set_logs row's actuals, by wire key. */
export function actualsFromSetLogRow(row: SetLogRow): LoggedActuals {
  const out = emptyLoggedActuals();
  const bag = out as Record<string, number | string | null>;
  for (const measure of LOGGED_MEASURES) {
    const { key, column } = SET_LOG_MEASURES[measure];
    const value = row[column];
    bag[key] = typeof value === "number" ? value : null;
  }
  out.tempo = row[SET_LOG_TEMPO.column] ?? null;
  return out;
}

/**
 * A parsed wire set's actuals. `weight` alone takes the exercise's REQUIRED
 * `weightUnit` tag — a non-web client logs in its own unit — and is canonical
 * kilograms from here on; every other measure arrives canonical (CONVENTIONS
 * section 20: no third tag).
 */
export function actualsFromWire(
  set: Partial<Record<ActualKey, number | string | undefined>>,
  weightUnit: "lbs" | "kg",
): LoggedActuals {
  const actuals = pickLoggedActuals(set);
  const weight = typeof set.weight === "number" ? set.weight : undefined;
  actuals.weight = toCanonicalWeightKg(weight, weightUnit) ?? null;
  return actuals;
}

type SetLogActualColumns = Pick<
  SetLogInsert,
  Measures[LoggedMeasure]["column"] | typeof SET_LOG_TEMPO.column
>;

/** The set_logs columns for a set's actuals, every one written (null included). */
export function setLogColumnsFromActuals(actuals: LoggedActuals): SetLogActualColumns {
  const bag = actuals as unknown as Record<string, number | string | null>;
  const out: Record<string, number | string | null> = {};
  for (const measure of LOGGED_MEASURES) {
    const { key, column } = SET_LOG_MEASURES[measure];
    out[column] = bag[key] ?? null;
  }
  out[SET_LOG_TEMPO.column] = actuals.tempo ?? null;
  return out as SetLogActualColumns;
}

