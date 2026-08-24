// Which prescription columns a coach fills in for an exercise (migration 149).
//
// Its own module rather than a section of exercise-set-specs.ts or
// set-spec-rows.ts: projectExerciseCompact (in the former) has to carry the
// column, and set-spec-rows already imports SetSpec from it — putting the
// helpers in either place makes that a runtime cycle.

/**
 * The columns a coach can choose to prescribe. Stored per exercise as
 * `prescribed_fields TEXT[]`; the CHECK constraint in migration 149 mirrors this
 * list, so the two must be changed together.
 *
 * `set_type` and `rest` are not columns of the client's grid — they gate the row
 * tag and the rest timer respectively. `reps`, `load` and `rpe` are.
 */
export const PRESCRIBED_FIELDS = [
  "set_type",
  "reps",
  "load",
  "rpe",
  "rest",
] as const;

export type PrescribedField = (typeof PRESCRIBED_FIELDS)[number];

const ALL_FIELDS: ReadonlySet<PrescribedField> = new Set(PRESCRIBED_FIELDS);

/**
 * Resolve the stored column to the set a renderer should honour.
 *
 * NULL means all five — the default every pre-149 row carries, and the value a
 * write path that forgot the column produces. Unknown strings are dropped rather
 * than trusted: the array is `TEXT[]`, so the CHECK is the only thing standing
 * between the DB and a typo, and a renderer should not be the second line.
 *
 * An empty (or entirely unrecognised) list resolves to all five as well. That
 * state is unauthorable through the UI and refused by the CHECK, so reaching it
 * means something upstream is broken — and showing the whole prescription is the
 * safe way to be wrong.
 */
export function resolvePrescribedFields(
  stored: readonly string[] | null | undefined,
): ReadonlySet<PrescribedField> {
  if (stored == null) return ALL_FIELDS;
  const known = stored.filter((f): f is PrescribedField =>
    ALL_FIELDS.has(f as PrescribedField),
  );
  return known.length > 0 ? new Set(known) : ALL_FIELDS;
}

/**
 * Narrow a stored `TEXT[]` to the authoring type, for a draft or a clone.
 *
 * The write-side twin of `resolvePrescribedFields`. They look alike and are not
 * interchangeable: this one preserves `null` because null is how "all five" is
 * STORED, while the other expands null to the full set because that is what
 * "all five" means when RENDERING. Same statement, two representations — use
 * this one whenever the value is on its way back to the database.
 *
 * Returns `null` — never `[]` — for absent, empty or wholly-unrecognised input,
 * because null is what "all five" is spelled as everywhere else and an empty
 * array is refused by the migration-149 CHECK.
 */
export function toPrescribedFields(
  stored: readonly string[] | null | undefined,
): PrescribedField[] | null {
  if (stored == null) return null;
  const known = stored.filter((f): f is PrescribedField =>
    ALL_FIELDS.has(f as PrescribedField),
  );
  return known.length > 0 ? known : null;
}
