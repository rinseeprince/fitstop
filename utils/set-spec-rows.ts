import { dropLoadValue, MAX_SET_SPECS } from "./exercise-set-specs";
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
 * Drop children inherit the parent's set number AND its load type, carrying
 * their own load value and reps. The type belongs to the set rather than to
 * each drop, so a drop set cannot mix units; the flattening is what hands each
 * row a self-describing copy.
 */
export function buildPrescribedRows(specs: SetSpec[]): PrescribedRow[] {
  const rows: PrescribedRow[] = [];

  specs.forEach((spec, specIndex) => {
    // Fall back to position when a legacy row carries no usable set_number,
    // so two rows can never display the same one.
    const setNumber = Number.isFinite(spec.set_number)
      ? spec.set_number
      : specIndex + 1;

    // AMRAP and to-failure sets prescribe NO rep count — that is what the type
    // means. The reps fields are read type-aware here, in the one place every
    // renderer goes through, rather than scrubbed on write: switching a set's
    // type in the editor leaves reps_min/reps_max behind, and the assistant can
    // author them too, so a write-side clear would cover neither the ~11k rows
    // that already carry a stale range nor a future writer. Expressing it here
    // makes the stale value unreadable instead of merely tidied, and it costs a
    // coach nothing when they switch a type back and forth.
    const openEnded =
      spec.set_type === "amrap" || spec.set_type === "failure";

    rows.push({
      setNumber,
      setType: spec.set_type,
      specIndex,
      dropIndex: null,
      repsMin: openEnded ? null : spec.reps_min ?? null,
      repsMax: openEnded ? null : spec.reps_max ?? null,
      repsTarget: openEnded ? null : spec.reps_target ?? null,
      loadType: spec.load_type ?? null,
      loadValue: spec.load_value ?? null,
      rpeTarget: spec.rpe_target ?? null,
      restSeconds: spec.rest_seconds ?? null,
    });

    if (spec.set_type !== "drop" || !spec.drops) return;

    spec.drops.forEach((drop, i) => {
      const loadValue = dropLoadValue(drop);
      rows.push({
        setNumber,
        setType: "drop",
        specIndex,
        dropIndex: i + 1,
        repsMin: drop.reps ?? null,
        repsMax: drop.reps ?? null,
        repsTarget: null,
        // The PARENT's load type. A drop is performed in the same unit as the
        // set it drops from, so the type lives once on the spec and the
        // flattening distributes it — the same division of labour as
        // `setNumber`, which drop children also inherit. It used to be
        // hardcoded to "absolute", which is why a "% 1RM" set's drops still
        // asked a coach for kilograms.
        loadType: loadValue == null ? null : (spec.load_type ?? "absolute"),
        loadValue,
        rpeTarget: null,
        restSeconds: null,
      });
    });
  });

  return rows;
}

/**
 * The number shown in each row's Set column.
 *
 * Not the array index: a drop child repeats its top set's number, and a set
 * appended past the prescription has no number of its own, so the column is a
 * running count. Returns the PARENT's number for a drop continuation — the
 * blanking is a render decision each grid makes from `dropIndex`, not something
 * baked in here, so a caller that wants to show `2b` still can.
 *
 * `rowCount` is passed separately because the client's log form can be LONGER
 * than the prescription (the client appends rows, or the coach shrank it after
 * the fact); rows past `rows.length` keep counting up.
 *
 * Shared, for the same reason `buildPrescribedRows` is: the client's log grid
 * and the coach's readout of that log must agree about which row is "set 3", or
 * a coach reads a number against the wrong prescription.
 */
export function buildSetDisplayNumbers(
  rows: PrescribedRow[],
  rowCount: number,
): number[] {
  const displayNumbers: number[] = [];
  let lastNumber = 0;
  for (let i = 0; i < rowCount; i++) {
    const prescribed = rows[i];
    if (prescribed?.dropIndex != null) {
      displayNumbers.push(lastNumber);
      continue;
    }
    lastNumber = prescribed?.setNumber ?? lastNumber + 1;
    displayNumbers.push(lastNumber);
  }
  return displayNumbers;
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
 * The rest interval that follows this row, or null when there isn't one.
 *
 * Rest is a property of the BOUNDARY between rows, not of a row — which is why
 * asking `rows[i].restSeconds` was wrong. A drop set is ONE set performed as
 * several rows, so its rest belongs after the last of them, and the children
 * carry `restSeconds: null` (a drop set is performed with no rest between
 * drops). Reading the field directly therefore dropped the rest a coach
 * prescribed on every drop set in the app.
 *
 * The value is NOT relocated onto the last child to fix that, deliberately. The
 * two surfaces ask different questions — a client tracker asks "is there a rest
 * interval here?", a coach readout asks "what rest does this set prescribe?" —
 * and moving it would serve the first by destroying the second. So
 * `restSeconds` stays a faithful projection of the spec, and this function owns
 * the boundary question, including the mid-drop-set suppression the grid used
 * to hand-roll.
 *
 * `rowCount` defaults to the prescription's own length; the client's log form
 * passes its own, because a client can append rows past the prescription and a
 * prescribed set followed by an appended one still has a rest interval after it.
 */
export function restAfterRow(
  rows: PrescribedRow[],
  index: number,
  rowCount: number = rows.length,
): number | null {
  const row = rows[index];
  if (!row) return null;
  // Nothing follows, so there is no interval to fill.
  if (index >= rowCount - 1) return null;
  // Mid drop set: the whole point of a drop is no rest before the next drop.
  if (isContinuationOfDropSet(rows, index + 1)) return null;

  const seconds =
    row.dropIndex == null
      ? row.restSeconds
      : (rows.find(
          (r) => r.specIndex === row.specIndex && r.dropIndex == null,
        )?.restSeconds ?? null);

  return seconds != null && seconds > 0 ? seconds : null;
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
