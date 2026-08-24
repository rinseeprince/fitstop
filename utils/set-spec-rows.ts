import { MAX_SET_SPECS } from "./exercise-set-specs";
import type { SetSpec, SetType } from "./exercise-set-specs";
import { MAX_DROPS } from "./set-spec-edits";

// The prescription, flattened to the rows a CLIENT logs against.
//
// The coach authors drop sets NESTED — one spec of `set_type: 'drop'` carrying a
// `drops[]` list — because that is how you think when writing a programme. Every
// serious tracker (Hevy, Strong) presents them FLAT to the athlete instead: the
// top set, then one tagged row per drop, logged like any other set. This module
// is that translation, and it is the ONLY one.
//
// It must stay shared. `training-log-service.ts` seeds `set_logs.set_type`
// POSITIONALLY from the prescription (`prescribedRows[setIdx]`), so a renderer
// that flattens differently from the seeder misattributes the type of every row
// after the first drop set — and `set_type` is what analytics use to exclude
// warm-ups, so the damage lands in the numbers rather than on screen.

/**
 * The most rows `buildPrescribedRows` can emit for one exercise: every spec a
 * drop set carrying the maximum number of drops.
 *
 * It bounds `setNumber` on the wire (`lib/validations/training.ts`). A set
 * number is real identity — the server writes it straight into
 * `set_logs.set_number` — so an out-of-range value has to be a 400 rather than
 * an integer error surfacing from Postgres. Derived from the two caps it
 * depends on so it cannot drift from them.
 */
export const MAX_PRESCRIBED_ROWS = MAX_SET_SPECS * (1 + MAX_DROPS);

export type PrescribedRow = {
  /** The coach's set number. Drop children repeat their parent's. */
  setNumber: number;
  setType: SetType;
  /** Index of the source spec — drop children share their parent's. */
  specIndex: number;
  /** 1-based drop position, or null for a primary row. */
  dropIndex: number | null;
  repsMin: number | null;
  repsMax: number | null;
  repsTarget: string | null;
  loadType: SetSpec["load_type"];
  loadValue: number | null;
  rpeTarget: number | null;
  /** Null on drop children: a drop set is performed with no rest between drops. */
  restSeconds: number | null;
};

/**
 * Expand authored specs into the client's flat row list.
 *
 * A `drop` spec yields its own row plus one row per entry in `drops[]`. Every
 * other type yields exactly one row, so an exercise with no drop sets flattens
 * to a list identical to the specs it came from.
 *
 * Drop children inherit the parent's set number and carry the drop's own weight
 * and reps. Their load is `absolute` because `drops[].weight` is a stored
 * kilogram value, never a percentage — the drop model has no load type of its
 * own.
 */
export function buildPrescribedRows(specs: SetSpec[]): PrescribedRow[] {
  const rows: PrescribedRow[] = [];

  specs.forEach((spec, specIndex) => {
    // Fall back to position when a legacy row carries no usable set_number,
    // so two rows can never display the same one.
    const setNumber = Number.isFinite(spec.set_number)
      ? spec.set_number
      : specIndex + 1;

    rows.push({
      setNumber,
      setType: spec.set_type,
      specIndex,
      dropIndex: null,
      repsMin: spec.reps_min ?? null,
      repsMax: spec.reps_max ?? null,
      repsTarget: spec.reps_target ?? null,
      loadType: spec.load_type ?? null,
      loadValue: spec.load_value ?? null,
      rpeTarget: spec.rpe_target ?? null,
      restSeconds: spec.rest_seconds ?? null,
    });

    if (spec.set_type !== "drop" || !spec.drops) return;

    spec.drops.forEach((drop, i) => {
      rows.push({
        setNumber,
        setType: "drop",
        specIndex,
        dropIndex: i + 1,
        repsMin: drop.reps ?? null,
        repsMax: drop.reps ?? null,
        repsTarget: null,
        loadType: drop.weight == null ? null : "absolute",
        loadValue: drop.weight ?? null,
        rpeTarget: null,
        restSeconds: null,
      });
    });
  });

  return rows;
}

/**
 * True when this row and the one before it are drops of the same set, i.e. the
 * rest timer between them must not appear. Named rather than inlined because
 * both the grid and its tests ask the question.
 */
export function isContinuationOfDropSet(
  rows: PrescribedRow[],
  index: number,
): boolean {
  const row = rows[index];
  const previous = rows[index - 1];
  if (!row || !previous) return false;
  return row.dropIndex != null && row.specIndex === previous.specIndex;
}

/**
 * The read-only Load cell's text.
 *
 * `unitLabel` is passed in rather than resolved here so this stays pure: the
 * viewer's unit belongs to the render boundary (CONVENTIONS §20), and the
 * caller has already converted `loadValue` into it for the absolute case.
 * Percentages are unitless and never convert.
 */
export function formatPrescribedLoad(
  row: Pick<PrescribedRow, "loadType" | "loadValue">,
  absoluteDisplayValue: string,
  unitLabel: string,
): string | null {
  if (row.loadType == null || row.loadValue == null) return null;
  switch (row.loadType) {
    case "absolute":
      return `${absoluteDisplayValue}${unitLabel}`;
    case "pct_1rm":
      return `${row.loadValue}% 1RM`;
    case "pct_top":
      return `${row.loadValue}% top set`;
  }
}
