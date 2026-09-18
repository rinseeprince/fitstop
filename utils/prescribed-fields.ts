// The columns a coach can prescribe on an exercise (migrations 149, 183).
//
// Its own module rather than a section of exercise-set-specs.ts or
// set-spec-rows.ts: projectExerciseCompact (in the former) has to carry the
// column, and set-spec-rows already imports SetSpec from it — putting the
// helpers in either place makes that a runtime cycle.

/**
 * THE definition of the measurement columns. Stored per exercise as
 * `prescribed_fields TEXT[] NOT NULL`; the CHECK constraint in migration 183
 * mirrors this list, and `prescribed-fields.test.ts` fails if the two differ.
 *
 * Strength: load, reps, RPE, RIR, tempo. Endurance: distance, duration, pace,
 * split, calories, cadence, stroke rate, resistance (damper), HR zone, target
 * HR, power, % FTP. Framework: set type, rest — `set_type` and `rest` are not
 * boxes of the client's grid; they gate the row tag and the rest timer.
 */
export const PRESCRIBED_FIELDS = [
  "set_type",
  "load",
  "reps",
  "rpe",
  "rir",
  "tempo",
  "distance",
  "duration",
  "pace",
  "split",
  "calories",
  "cadence",
  "stroke_rate",
  "resistance",
  "heart_rate_zone",
  "heart_rate",
  "power",
  "ftp_percent",
  "rest",
] as const;

export type PrescribedField = (typeof PRESCRIBED_FIELDS)[number];

/**
 * The columns every exercise starts on, and the columns an exercise carried
 * before it could choose (the migration-183 backfill writes this list). The
 * builder's Columns menu offers exactly these until commit 12's selector.
 */
export const DEFAULT_PRESCRIBED_FIELDS: readonly PrescribedField[] = [
  "set_type",
  "reps",
  "load",
  "rpe",
  "rest",
];

/** How each column is named to a coach or a client. */
export const PRESCRIBED_FIELD_LABELS: Record<PrescribedField, string> = {
  set_type: "Set type",
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
  heart_rate: "Target HR",
  power: "Power",
  ftp_percent: "% FTP",
  rest: "Rest",
};

const KNOWN: ReadonlySet<string> = new Set(PRESCRIBED_FIELDS);

export function isPrescribedField(value: unknown): value is PrescribedField {
  return typeof value === "string" && KNOWN.has(value);
}

/**
 * Narrow a stored or received list to the column names, in the list's own
 * order, as an array for a draft, a wire payload or a row on its way back to
 * the database.
 *
 * Unknown strings are dropped rather than trusted: the column is `TEXT[]`, so
 * the CHECK is the only thing standing between the database and a typo, and a
 * writer should not be the second line. The result is NEVER empty: a null,
 * empty or wholly-unrecognised list reads as today's five. That case cannot
 * come from a row (the column is NOT NULL and the CHECK refuses an empty list)
 * — it is how a log snapshot written before migration 149, which carries no
 * list, is read.
 */
export function toPrescribedFields(
  stored: readonly string[] | null | undefined,
): PrescribedField[] {
  const known = (stored ?? []).filter(isPrescribedField);
  return known.length > 0 ? known : [...DEFAULT_PRESCRIBED_FIELDS];
}

/**
 * The same list as the set a renderer asks `.has()` of. A snapshot with no
 * list, or a null one, reads as today's five.
 */
export function resolvePrescribedFields(
  stored: readonly string[] | null | undefined,
): ReadonlySet<PrescribedField> {
  return new Set(toPrescribedFields(stored));
}

/**
 * The columns a prescription snapshot names (`prescribed_exercise_snapshot`, or
 * the live exercise written in its shape), as the set a renderer asks. A
 * snapshot is JSON: anything but a list of strings reads as no list, and so as
 * today's five.
 */
export function snapshotPrescribedFields(
  snapshot: Record<string, unknown> | null | undefined,
): ReadonlySet<PrescribedField> {
  const listed = snapshot?.prescribed_fields;
  return resolvePrescribedFields(
    Array.isArray(listed)
      ? listed.filter((field): field is string => typeof field === "string")
      : null,
  );
}
