import { describe, it, expect } from "vitest";
import { deriveCompletionQuality, type ScoredExercise } from "./completion-quality";
import { buildPrescribedRows } from "./set-spec-rows";
import type { SetSpec } from "./exercise-set-specs";

// Build the flattened prescription the same way every caller does, so these
// cases exercise the real row shapes (drop children included) rather than
// hand-written PrescribedRow literals that could drift from buildPrescribedRows.
function rows(specs: Partial<SetSpec>[]): ScoredExercise["prescribedRows"] {
  return buildPrescribedRows(
    specs.map((s, i) => ({
      set_number: i + 1,
      set_type: "working",
      ...s,
    })) as SetSpec[],
  );
}

const WORKING_3 = rows([{}, {}, {}]);
const WARMUP_THEN_2 = rows([{ set_type: "warmup" }, {}, {}]);

describe("deriveCompletionQuality", () => {
  it("returns full when every prescribed working set was sent", () => {
    expect(
      deriveCompletionQuality([
        { prescribedRows: WORKING_3, completedSetNumbers: [1, 2, 3] },
      ]),
    ).toBe("full");
  });

  it("returns partial when some were sent", () => {
    expect(
      deriveCompletionQuality([
        { prescribedRows: WORKING_3, completedSetNumbers: [2] },
      ]),
    ).toBe("partial");
  });

  it("returns skipped when none were sent", () => {
    expect(
      deriveCompletionQuality([
        { prescribedRows: WORKING_3, completedSetNumbers: [] },
      ]),
    ).toBe("skipped");
  });

  // Locked decision 5: warm-ups are recorded but never scored.
  it("excludes warm-ups from the numerator — ticking only the warm-up is skipped", () => {
    expect(
      deriveCompletionQuality([
        { prescribedRows: WARMUP_THEN_2, completedSetNumbers: [1] },
      ]),
    ).toBe("skipped");
  });

  it("excludes warm-ups from the denominator — the working sets alone make it full", () => {
    expect(
      deriveCompletionQuality([
        { prescribedRows: WARMUP_THEN_2, completedSetNumbers: [2, 3] },
      ]),
    ).toBe("full");
  });

  // Locked decision 4: "on EVERY exercise". An exercise the payload never
  // mentions still counts against the client — this is the case a
  // payload-derived denominator cannot see.
  it("counts an exercise with nothing sent against the session", () => {
    expect(
      deriveCompletionQuality([
        { prescribedRows: WORKING_3, completedSetNumbers: [1, 2, 3] },
        { prescribedRows: WORKING_3, completedSetNumbers: [] },
      ]),
    ).toBe("partial");
  });

  it("is partial when one exercise of two is short, however complete the other is", () => {
    expect(
      deriveCompletionQuality([
        { prescribedRows: WORKING_3, completedSetNumbers: [1, 2, 3] },
        { prescribedRows: WORKING_3, completedSetNumbers: [1, 2] },
      ]),
    ).toBe("partial");
  });

  it("scores an unplanned exercise on neither side", () => {
    expect(
      deriveCompletionQuality([
        { prescribedRows: WORKING_3, completedSetNumbers: [1, 2, 3] },
        { prescribedRows: [], completedSetNumbers: [1, 2] },
      ]),
    ).toBe("full");
  });

  // Nothing scorable at all — the caller falls back to the client's own claim
  // rather than recording `skipped` for a client who may have logged everything.
  it("returns null when nothing prescribed is scorable", () => {
    expect(deriveCompletionQuality([])).toBeNull();
    expect(
      deriveCompletionQuality([
        { prescribedRows: [], completedSetNumbers: [1] },
      ]),
    ).toBeNull();
    expect(
      deriveCompletionQuality([
        {
          prescribedRows: rows([{ set_type: "warmup" }, { set_type: "warmup" }]),
          completedSetNumbers: [1, 2],
        },
      ]),
    ).toBeNull();
  });

  it("counts a repeated set number once", () => {
    expect(
      deriveCompletionQuality([
        { prescribedRows: WORKING_3, completedSetNumbers: [1, 1, 1] },
      ]),
    ).toBe("partial");
  });

  // The coach shrank the prescription after the client logged it: the sets with
  // no row behind them score nothing, and what remains is complete.
  it("ignores a set number past the end of the prescription", () => {
    expect(
      deriveCompletionQuality([
        { prescribedRows: WORKING_3, completedSetNumbers: [1, 2, 3, 4, 5] },
      ]),
    ).toBe("full");
  });

  // A drop set flattens to its top set plus one row per drop, and each of those
  // rows is a set the client has to do — 3 rows here, not 1.
  it("counts a drop set's flattened rows individually", () => {
    const dropRows = rows([
      { set_type: "drop", drops: [{ weight: 60, reps: 8 }, { weight: 40, reps: 8 }] },
    ]);
    expect(dropRows).toHaveLength(3);
    expect(
      deriveCompletionQuality([
        { prescribedRows: dropRows, completedSetNumbers: [1, 2] },
      ]),
    ).toBe("partial");
    expect(
      deriveCompletionQuality([
        { prescribedRows: dropRows, completedSetNumbers: [1, 2, 3] },
      ]),
    ).toBe("full");
  });
});
