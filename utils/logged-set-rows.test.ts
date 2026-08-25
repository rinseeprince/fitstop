import { describe, it, expect } from "vitest";
import type { SetSpec } from "./exercise-set-specs";
import { buildPrescribedRows, MAX_PRESCRIBED_ROWS } from "./set-spec-rows";
import { buildLoggedSetRows, type LoggedSetInput } from "./logged-set-rows";

function spec(overrides: Partial<SetSpec> & { set_number: number }): SetSpec {
  return {
    set_type: "working",
    reps_min: null,
    reps_max: null,
    reps_target: null,
    load_type: null,
    load_value: null,
    rpe_target: null,
    tempo: null,
    rest_seconds: null,
    drops: null,
    ...overrides,
  };
}

function log(overrides: Partial<LoggedSetInput> & { setNumber: number }): LoggedSetInput {
  return { reps: null, weight: null, rpe: null, ...overrides };
}

// A six-row prescription: one warm-up then five working sets.
const SIX_ROWS = buildPrescribedRows([
  spec({ set_number: 1, set_type: "warmup", reps_min: 15, reps_max: 15 }),
  spec({ set_number: 2, reps_min: 8, reps_max: 12 }),
  spec({ set_number: 3, reps_min: 8, reps_max: 12 }),
  spec({ set_number: 4, reps_min: 8, reps_max: 12 }),
  spec({ set_number: 5, reps_min: 8, reps_max: 12 }),
  spec({ set_number: 6, reps_min: 8, reps_max: 12 }),
]);

describe("buildLoggedSetRows", () => {
  it("renders every prescribed set, logged or not", () => {
    const rows = buildLoggedSetRows(SIX_ROWS, [
      log({ setNumber: 2, reps: 10, weight: 60 }),
      log({ setNumber: 3, reps: 9, weight: 60 }),
    ]);

    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.actual !== null)).toEqual([
      false,
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  it("pairs a log with the row its setNumber INDEXES, not the coach's number", () => {
    // A drop set: flattened rows are top(2), drop(2), drop(2) — three rows all
    // displaying set 2, but indexed 2, 3 and 4 on the wire.
    const rows = buildLoggedSetRows(
      buildPrescribedRows([
        spec({ set_number: 1 }),
        spec({
          set_number: 2,
          set_type: "drop",
          drops: [{ weight: 60, reps: 8 }, { weight: 40, reps: 6 }],
        }),
      ]),
      [log({ setNumber: 4, reps: 6, weight: 40 })],
    );

    expect(rows).toHaveLength(4);
    expect(rows[3].prescribed?.dropIndex).toBe(2);
    expect(rows[3].actual).toEqual({ reps: 6, weight: 40, rpe: null });
    // The three drop rows all display the top set's number.
    expect(rows.map((r) => r.displayNumber)).toEqual([1, 2, 2, 2]);
    expect(rows.filter((r) => r.actual !== null)).toHaveLength(1);
  });

  it("keeps a logged set PAST the prescription", () => {
    const rows = buildLoggedSetRows(SIX_ROWS, [
      log({ setNumber: 6, reps: 8 }),
      log({ setNumber: 8, reps: 6, weight: 50 }),
    ]);

    expect(rows).toHaveLength(8);
    expect(rows[7].prescribed).toBeNull();
    expect(rows[7].actual).toEqual({ reps: 6, weight: 50, rpe: null });
    // Row 7 is neither prescribed nor logged — an appended row's gap.
    expect(rows[6].prescribed).toBeNull();
    expect(rows[6].actual).toBeNull();
  });

  it("distinguishes a ticked-but-empty set from a set that was not done", () => {
    const rows = buildLoggedSetRows(SIX_ROWS, [log({ setNumber: 2 })]);

    // Doing the work is the claim; recording numbers is a bonus. The row exists
    // with all three values null, which must not read as "not done".
    expect(rows[1].actual).toEqual({ reps: null, weight: null, rpe: null });
    expect(rows[2].actual).toBeNull();
  });

  it("ignores a set number outside the row list", () => {
    const rows = buildLoggedSetRows(SIX_ROWS, [
      log({ setNumber: 0, reps: 5 }),
      log({ setNumber: -1, reps: 5 }),
      log({ setNumber: 1.5, reps: 5 }),
    ]);

    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.actual === null)).toBe(true);
  });

  it("caps the list at the wire's own setNumber bound", () => {
    const rows = buildLoggedSetRows(SIX_ROWS, [
      log({ setNumber: 1_000_000, reps: 5 }),
    ]);

    expect(rows).toHaveLength(MAX_PRESCRIBED_ROWS);
    // The corrupt row is past the cap, so nothing is paired to it.
    expect(rows.every((r) => r.actual === null)).toBe(true);
  });

  it("renders a log with no prescription at all", () => {
    const rows = buildLoggedSetRows([], [
      log({ setNumber: 1, reps: 12, weight: 20 }),
      log({ setNumber: 2, reps: 12, weight: 20 }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.displayNumber)).toEqual([1, 2]);
    expect(rows.every((r) => r.prescribed === null)).toBe(true);
  });

  it("returns nothing when there is neither a prescription nor a log", () => {
    expect(buildLoggedSetRows([], [])).toEqual([]);
  });

  it("carries the last write when two logs claim one row", () => {
    // Unreachable through the DB (set_logs is UNIQUE on exercise_log_id +
    // set_number), so this pins the defensive behaviour rather than a real case.
    const rows = buildLoggedSetRows(SIX_ROWS, [
      log({ setNumber: 2, reps: 10 }),
      log({ setNumber: 2, reps: 11 }),
    ]);

    expect(rows[1].actual?.reps).toBe(11);
  });
});
