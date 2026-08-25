import {
  buildSetDisplayNumbers,
  MAX_PRESCRIBED_ROWS,
  type PrescribedRow,
} from "./set-spec-rows";

// The prescription paired with what was actually logged against it — the model
// behind the coach's logged-workout readout.
//
// The PRESCRIPTION drives the row list, not the log. That inversion is the whole
// point: a readout built from `set_logs` alone can only show sets the client
// did, so a prescribed set they never got to simply vanished, and a coach
// reading four rows had no way to know six were asked for.
//
// Alignment is by `set_logs.set_number`, which is a 1-BASED INDEX INTO THE
// FLATTENED PRESCRIPTION (per-set completion Phase 1) — not the coach's set
// number, which drop children repeat. `training-log-service` stamps
// `set_logs.set_type` from `prescribedRows[setNumber - 1]`, so pairing on
// anything else would put a row beside a different spec from the one it was
// typed against.

/** What the client recorded for one set. Every field is optional detail. */
type LoggedSetActuals = {
  reps: number | null;
  weight: number | null;
  rpe: number | null;
};

/** The minimum a caller must supply per logged set (a `SetLog` satisfies it). */
export type LoggedSetInput = LoggedSetActuals & {
  setNumber: number;
};

export type LoggedSetRow = {
  /** The number for the Set column, from the shared running count. */
  displayNumber: number;
  /**
   * This row's prescription, or null for a set logged PAST it — reachable two
   * ways: the client appended rows of their own, or the coach shrank the
   * prescription after the fact.
   */
  prescribed: PrescribedRow | null;
  /**
   * What was logged, or null for a prescribed set with no log — which renders
   * as NOT DONE rather than being omitted.
   *
   * A non-null value with all three fields null is a different state and must
   * stay distinguishable: the client ticked the set and recorded no numbers,
   * which is a truthful record of work done (per-set completion, locked
   * decision 3).
   */
  actual: LoggedSetActuals | null;
};

/**
 * Pair a flattened prescription with the sets logged against it.
 *
 * The list is sized to hold BOTH ends — the prescription, and the highest set
 * number actually logged — the same rule the client's own reopen path uses
 * (`restoreSetsFromLog`), and for the same reason: a logged set past the
 * prescription is real, and dropping it from the coach's view would hide a set
 * the client did.
 *
 * `MAX_PRESCRIBED_ROWS` is the wire's own bound on `setNumber`, so the cap can
 * never truncate anything a client could legitimately have sent. It is here so a
 * corrupt stored `set_number` cannot ask the browser for a billion-row array.
 */
export function buildLoggedSetRows(
  prescribedRows: PrescribedRow[],
  logs: readonly LoggedSetInput[],
): LoggedSetRow[] {
  const highestLogged = logs.reduce(
    (max, s) =>
      Number.isInteger(s.setNumber) && s.setNumber > max ? s.setNumber : max,
    0,
  );
  const rowCount = Math.min(
    Math.max(prescribedRows.length, highestLogged),
    MAX_PRESCRIBED_ROWS,
  );
  if (rowCount === 0) return [];

  const byIndex = new Map<number, LoggedSetActuals>();
  for (const log of logs) {
    const index = log.setNumber - 1;
    if (!Number.isInteger(index) || index < 0 || index >= rowCount) continue;
    byIndex.set(index, {
      reps: log.reps,
      weight: log.weight,
      rpe: log.rpe,
    });
  }

  const displayNumbers = buildSetDisplayNumbers(prescribedRows, rowCount);

  return Array.from({ length: rowCount }, (_, i) => ({
    displayNumber: displayNumbers[i],
    prescribed: prescribedRows[i] ?? null,
    actual: byIndex.get(i) ?? null,
  }));
}
