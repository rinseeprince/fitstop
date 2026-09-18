import { describe, it, expect } from "vitest";
import type { SetSpec } from "./exercise-set-specs";
import { buildPrescribedRows, MAX_PRESCRIBED_ROWS } from "./set-spec-rows";
import { emptyLoggedActuals } from "./set-log-measures";
import { buildLoggedSetRows, loggedColumns, type LoggedSetInput } from "./logged-set-rows";
import { resolvePrescribedFields } from "./prescribed-fields";

function spec(overrides: Partial<SetSpec> & { set_number: number }): SetSpec {
  return {
    set_type: "working",
    reps_min: null,
    reps_max: null,
    reps_target: null,
    load_type: null,
    load_min: null, load_max: null,
    rpe_min: null,
    rpe_max: null,
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
    expect(rows[3].actual).toEqual({ ...emptyLoggedActuals(), reps: 6, weight: 40 });
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
    expect(rows[7].actual).toEqual({ ...emptyLoggedActuals(), reps: 6, weight: 50 });
    // Row 7 is neither prescribed nor logged — an appended row's gap.
    expect(rows[6].prescribed).toBeNull();
    expect(rows[6].actual).toBeNull();
  });

  it("distinguishes a ticked-but-empty set from a set that was not done", () => {
    const rows = buildLoggedSetRows(SIX_ROWS, [log({ setNumber: 2 })]);

    // Doing the work is the claim; recording numbers is a bonus. The row exists
    // with every value null, which must not read as "not done".
    expect(rows[1].actual).toEqual(emptyLoggedActuals());
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

// The columns the coach's table and the check-in AI's lines walk: the boxes the
// coach prescribed, and anything else the rows carry, so history hides nothing.
describe("loggedColumns", () => {
  const run = resolvePrescribedFields(["set_type", "distance", "duration", "pace", "rest"]);

  it("gives every prescribed box, in the columns' order, and never set type or rest", () => {
    const rows = buildLoggedSetRows(buildPrescribedRows([spec({ set_number: 1 })]), []);
    expect(loggedColumns(run, rows, "metric")).toEqual({
      boxes: ["distance", "duration", "pace"],
      rest: false,
    });
    expect(
      loggedColumns(resolvePrescribedFields(["rpe", "load", "set_type", "reps"]), rows, "metric").boxes,
    ).toEqual(["load", "reps", "rpe"]);
  });

  it("adds a box a row sets a target in, though the columns don't name it", () => {
    const rows = buildLoggedSetRows(
      buildPrescribedRows([spec({ set_number: 1, rpe_min: 8, rpe_max: 8 })]),
      [],
    );
    expect(loggedColumns(run, rows, "metric").boxes).toEqual(["rpe", "distance", "duration", "pace"]);
  });

  it("adds a box a set recorded a value in, so a value is never hidden", () => {
    const rows = buildLoggedSetRows(buildPrescribedRows([spec({ set_number: 1 })]), [
      log({ setNumber: 1, heartRateZone: 3 }),
    ]);
    expect(loggedColumns(run, rows, "metric").boxes).toEqual([
      "distance",
      "duration",
      "pace",
      "heart_rate_zone",
    ]);
  });

  it("shows Rest only when a set recorded the rest taken", () => {
    const prescription = buildPrescribedRows([spec({ set_number: 1, rest_seconds: 90 })]);
    expect(loggedColumns(run, buildLoggedSetRows(prescription, [log({ setNumber: 1 })]), "metric").rest).toBe(
      false,
    );
    expect(
      loggedColumns(run, buildLoggedSetRows(prescription, [log({ setNumber: 1, restSeconds: 95 })]), "metric")
        .rest,
    ).toBe(true);
  });

  it("does not add a load a row stores with no unit, which reads as nothing", () => {
    const rows = buildLoggedSetRows(
      buildPrescribedRows([spec({ set_number: 1, load_type: null, load_min: 100, load_max: 100 })]),
      [],
    );
    expect(loggedColumns(run, rows, "metric").boxes).not.toContain("load");
  });
});
