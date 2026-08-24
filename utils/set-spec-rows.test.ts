import { describe, it, expect } from "vitest";
import type { SetSpec } from "./exercise-set-specs";
import {
  buildPrescribedRows,
  formatPrescribedLoad,
  isContinuationOfDropSet,
} from "./set-spec-rows";

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

describe("buildPrescribedRows", () => {
  it("is 1:1 for an exercise with no drop sets", () => {
    const specs = [
      spec({ set_number: 1, set_type: "warmup", reps_min: 15, reps_max: 20 }),
      spec({ set_number: 2, reps_min: 8, reps_max: 12 }),
    ];
    const rows = buildPrescribedRows(specs);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.setType)).toEqual(["warmup", "working"]);
    expect(rows.every((r) => r.dropIndex === null)).toBe(true);
  });

  it("carries each set's OWN reps, which is the bug the client had", () => {
    const rows = buildPrescribedRows([
      spec({ set_number: 1, set_type: "warmup", reps_min: 15, reps_max: 20 }),
      spec({ set_number: 2, reps_min: 10, reps_max: 12 }),
      spec({ set_number: 3, reps_min: 8, reps_max: 10 }),
    ]);
    expect(rows.map((r) => [r.repsMin, r.repsMax])).toEqual([
      [15, 20],
      [10, 12],
      [8, 10],
    ]);
  });

  it("expands a drop set into its top set plus one row per drop", () => {
    const rows = buildPrescribedRows([
      spec({ set_number: 1, reps_min: 8, reps_max: 10 }),
      spec({
        set_number: 2,
        set_type: "drop",
        reps_min: 8,
        reps_max: 10,
        load_type: "absolute",
        load_value: 80,
        rest_seconds: 180,
        drops: [
          { weight: 60, reps: 8 },
          { weight: 40, reps: 10 },
        ],
      }),
    ]);

    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.dropIndex)).toEqual([null, null, 1, 2]);
    // Drop children repeat the parent's set number and spec index.
    expect(rows.map((r) => r.setNumber)).toEqual([1, 2, 2, 2]);
    expect(rows.map((r) => r.specIndex)).toEqual([0, 1, 1, 1]);
    // A drop's weight is a stored kilogram, so it reads as an absolute load.
    expect(rows[2]).toMatchObject({
      loadType: "absolute",
      loadValue: 60,
      repsMin: 8,
      repsMax: 8,
    });
    // No rest between drops.
    expect(rows[2].restSeconds).toBeNull();
    expect(rows[3].restSeconds).toBeNull();
    expect(rows[1].restSeconds).toBe(180);
  });

  it("leaves a drop set with no drops as a single row", () => {
    const rows = buildPrescribedRows([
      spec({ set_number: 1, set_type: "drop", drops: null }),
      spec({ set_number: 2, set_type: "drop", drops: [] }),
    ]);
    expect(rows).toHaveLength(2);
  });

  it("keeps AMRAP and failure rep targets on their own row", () => {
    const rows = buildPrescribedRows([
      spec({ set_number: 1, set_type: "amrap", reps_target: "AMRAP" }),
      spec({ set_number: 2, set_type: "failure", reps_target: "To failure" }),
    ]);
    expect(rows.map((r) => r.repsTarget)).toEqual(["AMRAP", "To failure"]);
  });

  it("falls back to position when a legacy row has no usable set_number", () => {
    const rows = buildPrescribedRows([
      { ...spec({ set_number: 1 }), set_number: undefined as unknown as number },
      spec({ set_number: 2 }),
    ]);
    expect(rows.map((r) => r.setNumber)).toEqual([1, 2]);
  });

  it("keeps position aligned with the specs so positional set_type seeding is safe", () => {
    // training-log-service seeds set_logs.set_type from rows[setIdx]. Every row
    // after a drop set shifts, which is exactly why both sides share this fn.
    const rows = buildPrescribedRows([
      spec({ set_number: 1, set_type: "warmup" }),
      spec({
        set_number: 2,
        set_type: "drop",
        drops: [{ weight: 50, reps: 8 }],
      }),
      spec({ set_number: 3, set_type: "failure" }),
    ]);
    expect(rows.map((r) => r.setType)).toEqual([
      "warmup",
      "drop",
      "drop",
      "failure",
    ]);
  });
});

describe("isContinuationOfDropSet", () => {
  const rows = buildPrescribedRows([
    spec({ set_number: 1 }),
    spec({
      set_number: 2,
      set_type: "drop",
      drops: [{ weight: 60, reps: 8 }, { weight: 40, reps: 8 }],
    }),
    spec({ set_number: 3 }),
  ]);

  it("is false for the first row and for primary rows", () => {
    expect(isContinuationOfDropSet(rows, 0)).toBe(false);
    expect(isContinuationOfDropSet(rows, 1)).toBe(false);
    expect(isContinuationOfDropSet(rows, 4)).toBe(false);
  });

  it("is true for each drop that follows its own top set", () => {
    expect(isContinuationOfDropSet(rows, 2)).toBe(true);
    expect(isContinuationOfDropSet(rows, 3)).toBe(true);
  });
});

describe("formatPrescribedLoad", () => {
  it("renders an absolute load in the viewer's unit", () => {
    expect(
      formatPrescribedLoad({ loadType: "absolute", loadValue: 100 }, "100", "kg"),
    ).toBe("100kg");
  });

  it("renders percentages unitless, never as a weight", () => {
    expect(
      formatPrescribedLoad({ loadType: "pct_1rm", loadValue: 60 }, "", "kg"),
    ).toBe("60% 1RM");
    expect(
      formatPrescribedLoad({ loadType: "pct_top", loadValue: 80 }, "", "kg"),
    ).toBe("80% top set");
  });

  it("returns null when nothing is prescribed", () => {
    expect(formatPrescribedLoad({ loadType: null, loadValue: null }, "", "kg")).toBeNull();
    expect(formatPrescribedLoad({ loadType: "absolute", loadValue: null }, "", "kg")).toBeNull();
  });
});
