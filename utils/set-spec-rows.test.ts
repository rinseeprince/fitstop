import { describe, it, expect } from "vitest";
import type { SetSpec } from "./exercise-set-specs";
import {
  buildPrescribedRows,
  buildSetDisplayNumbers,
  formatPrescribedLoad,
  isContinuationOfDropSet,
  restAfterRow,
} from "./set-spec-rows";
import { PRESCRIBED_FIELDS, resolvePrescribedFields } from "./prescribed-fields";

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

  it("emits no rep prescription for AMRAP and failure rows", () => {
    // REVERSES an earlier assertion that these rows KEPT their reps_target.
    // "As many reps as possible" is the prescription; a rep count alongside it
    // contradicts the type, and the stale ranges the editor left behind were
    // reaching the client as though a coach had prescribed them. See the
    // "open-ended sets prescribe no reps" block below.
    const rows = buildPrescribedRows([
      spec({ set_number: 1, set_type: "amrap", reps_target: "AMRAP" }),
      spec({ set_number: 2, set_type: "failure", reps_target: "To failure" }),
    ]);
    expect(rows.map((r) => r.repsTarget)).toEqual([null, null]);
    expect(rows.map((r) => r.setType)).toEqual(["amrap", "failure"]);
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

describe("open-ended sets prescribe no reps", () => {
  it("drops a stale rep range from an AMRAP set", () => {
    // Reachable two ways: the editor leaves reps_min/reps_max behind when a
    // coach switches a working set to AMRAP, and the assistant can author both.
    const rows = buildPrescribedRows([
      spec({ set_number: 1, set_type: "amrap", reps_min: 7, reps_max: 11 }),
    ]);

    expect(rows[0].repsMin).toBeNull();
    expect(rows[0].repsMax).toBeNull();
    expect(rows[0].repsTarget).toBeNull();
    expect(rows[0].setType).toBe("amrap");
  });

  it("does the same for a to-failure set", () => {
    const rows = buildPrescribedRows([
      spec({
        set_number: 1,
        set_type: "failure",
        reps_min: 8,
        reps_max: 8,
        reps_target: "8+",
      }),
    ]);

    expect(rows[0].repsMin).toBeNull();
    expect(rows[0].repsMax).toBeNull();
    expect(rows[0].repsTarget).toBeNull();
  });

  it("keeps everything else about the set", () => {
    const rows = buildPrescribedRows([
      spec({
        set_number: 1,
        set_type: "amrap",
        reps_min: 7,
        reps_max: 11,
        load_type: "pct_1rm",
        load_value: 60,
        rpe_target: 9,
        rest_seconds: 120,
      }),
    ]);

    expect(rows[0].loadType).toBe("pct_1rm");
    expect(rows[0].loadValue).toBe(60);
    expect(rows[0].rpeTarget).toBe(9);
    expect(rows[0].restSeconds).toBe(120);
  });

  it("leaves working and warm-up sets untouched", () => {
    const rows = buildPrescribedRows([
      spec({ set_number: 1, set_type: "warmup", reps_min: 15, reps_max: 15 }),
      spec({ set_number: 2, reps_min: 8, reps_max: 12, reps_target: "8-12/side" }),
    ]);

    expect(rows[0].repsMin).toBe(15);
    expect(rows[1].repsMax).toBe(12);
    expect(rows[1].repsTarget).toBe("8-12/side");
  });
});

describe("buildSetDisplayNumbers", () => {
  it("counts primary rows and repeats a drop's parent number", () => {
    const rows = buildPrescribedRows([
      spec({ set_number: 1, set_type: "warmup" }),
      spec({
        set_number: 2,
        set_type: "drop",
        drops: [{ weight: 60, reps: 8 }, { weight: 40, reps: 8 }],
      }),
      spec({ set_number: 3 }),
    ]);

    // Flattened: warmup(1), drop top(2), drop(2), drop(2), working(3).
    expect(buildSetDisplayNumbers(rows, rows.length)).toEqual([1, 2, 2, 2, 3]);
  });

  it("keeps counting past the prescription for appended rows", () => {
    const rows = buildPrescribedRows([spec({ set_number: 1 }), spec({ set_number: 2 })]);

    expect(buildSetDisplayNumbers(rows, 4)).toEqual([1, 2, 3, 4]);
  });

  it("honours an authored set_number that does not match position", () => {
    const rows = buildPrescribedRows([
      spec({ set_number: 5 }),
      spec({ set_number: 6 }),
    ]);

    expect(buildSetDisplayNumbers(rows, 2)).toEqual([5, 6]);
  });

  it("returns nothing for a zero row count", () => {
    expect(buildSetDisplayNumbers([], 0)).toEqual([]);
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

describe("restAfterRow", () => {
  // set 1 (rest 90) · set 2 = drop with 2 drops (rest 120) · set 3 (rest 60)
  // Flattened: [1, 2-top, 2-drop1, 2-drop2, 3]
  const rows = buildPrescribedRows([
    spec({ set_number: 1, rest_seconds: 90 }),
    spec({
      set_number: 2,
      set_type: "drop",
      rest_seconds: 120,
      drops: [{ weight: 60, reps: 8 }, { weight: 40, reps: 6 }],
    }),
    spec({ set_number: 3, rest_seconds: 60 }),
  ]);

  it("returns a plain set's own rest", () => {
    expect(restAfterRow(rows, 0)).toBe(90);
  });

  it("suppresses rest between the drops of one set", () => {
    expect(restAfterRow(rows, 1)).toBeNull(); // top set → first drop
    expect(restAfterRow(rows, 2)).toBeNull(); // first drop → second drop
  });

  it("fires the drop set's rest after its LAST drop", () => {
    // The regression this exists for: rest_seconds lives on the parent spec and
    // the children carry null, so reading the row's own field lost it entirely.
    expect(restAfterRow(rows, 3)).toBe(120);
  });

  it("returns null when nothing follows", () => {
    expect(restAfterRow(rows, 4)).toBeNull();
  });

  it("still fires when an APPENDED row follows the prescription", () => {
    // The client can add sets past the prescription; the last prescribed set
    // still has a rest interval after it.
    expect(restAfterRow(rows, 4, 6)).toBe(60);
  });

  it("returns null for a set that prescribes no rest", () => {
    const none = buildPrescribedRows([
      spec({ set_number: 1 }),
      spec({ set_number: 2 }),
    ]);
    expect(restAfterRow(none, 0)).toBeNull();
  });

  it("returns null for a zero rest and for an out-of-range index", () => {
    const zero = buildPrescribedRows([
      spec({ set_number: 1, rest_seconds: 0 }),
      spec({ set_number: 2 }),
    ]);
    expect(restAfterRow(zero, 0)).toBeNull();
    expect(restAfterRow(rows, 99)).toBeNull();
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

describe("resolvePrescribedFields", () => {
  it("treats NULL as every column — the default every pre-149 row carries", () => {
    expect([...resolvePrescribedFields(null)].sort()).toEqual(
      [...PRESCRIBED_FIELDS].sort(),
    );
    expect([...resolvePrescribedFields(undefined)]).toHaveLength(5);
  });

  it("honours an explicit subset", () => {
    const fields = resolvePrescribedFields(["reps", "rest"]);
    expect(fields.has("reps")).toBe(true);
    expect(fields.has("rest")).toBe(true);
    expect(fields.has("load")).toBe(false);
    expect(fields.has("rpe")).toBe(false);
    expect(fields.has("set_type")).toBe(false);
  });

  it("drops unknown values rather than trusting a TEXT[] column", () => {
    expect([...resolvePrescribedFields(["reps", "tempo", "nonsense"])]).toEqual([
      "reps",
    ]);
  });

  it("falls back to everything when the list is empty or all unknown", () => {
    // Unauthorable and CHECK-refused, so reaching it means something upstream
    // broke — show the whole prescription rather than an empty grid.
    expect(resolvePrescribedFields([]).size).toBe(5);
    expect(resolvePrescribedFields(["bogus"]).size).toBe(5);
  });
});
