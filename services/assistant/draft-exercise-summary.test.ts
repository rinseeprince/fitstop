import { describe, it, expect } from "vitest";
import type { SetSpec } from "@/utils/exercise-set-specs";
import type { ExerciseDraft } from "@/components/clients/training/program-builder/program-builder-types";
import { formatLoads, formatReps, formatSetCount } from "./draft-exercise-summary";

function exercise(over: Partial<ExerciseDraft> = {}): ExerciseDraft {
  return {
    uid: "ex-1",
    exerciseId: "e-bench",
    name: "Bench Press",
    setSpecs: null,
    sets: 3,
    repsMin: 8,
    repsMax: 12,
    repsTarget: null,
    rpeTarget: null,
    percentage1rm: null,
    tempo: null,
    restSeconds: null,
    isWarmup: false,
    notes: null,
    videoUrl: null,
    prescribedFields: ["set_type", "reps", "load", "rpe", "rest"],
    ...over,
  };
}

const working = (n: number, over: Partial<SetSpec> = {}): SetSpec => ({
  set_number: n,
  set_type: "working",
  ...over,
});

describe("an exercise's working sets as the model reads them", () => {
  it("formatLoads: uniform absolute loads share one kg suffix", () => {
    const ex = exercise({
      setSpecs: [
        { set_number: 1, set_type: "warmup", load_type: "absolute", load_min: 60, load_max: 60 },
        working(2, { load_type: "absolute", load_min: 100, load_max: 100 }),
        working(3, { load_type: "absolute", load_min: 90, load_max: 90 }),
      ],
    });
    expect(formatLoads(ex)).toBe("100 / 90 kg");
  });

  it("formatLoads: uniform percent loads use per-token %", () => {
    const ex = exercise({
      setSpecs: [
        working(1, { load_type: "pct_1rm", load_min: 70, load_max: 70 }),
        working(2, { load_type: "pct_top", load_min: 85, load_max: 85 }),
      ],
    });
    expect(formatLoads(ex)).toBe("70% / 85%");
  });

  it("formatLoads: mixed/missing loads fall back to per-token units", () => {
    const ex = exercise({
      setSpecs: [
        working(1, { load_type: "absolute", load_min: 100, load_max: 100 }),
        working(2, { load_type: "pct_1rm", load_min: 70, load_max: 70 }),
        working(3),
      ],
    });
    expect(formatLoads(ex)).toBe("100kg / 70% / —");
  });

  it("formatLoads: equal working sets collapse to one value, as reps do", () => {
    const ex = exercise({
      setSpecs: [
        { set_number: 1, set_type: "working", load_type: "absolute", load_min: 100, load_max: 105 },
        { set_number: 2, set_type: "working", load_type: "absolute", load_min: 100, load_max: 105 },
      ],
    });
    expect(formatLoads(ex)).toBe("100–105 kg");
  });

  it("formatLoads: compact-only exercise renders its synthesized specs", () => {
    expect(formatLoads(exercise({ percentage1rm: 75 }))).toBe("75%");
    expect(formatLoads(exercise())).toBe("—");
  });

  it("formatLoads: reads canonical kilograms, never converted or snapped", () => {
    const ex = exercise({
      setSpecs: [working(1, { load_type: "absolute", load_min: 102.25, load_max: 102.25 })],
    });
    expect(formatLoads(ex)).toBe("102.25 kg");
  });

  it("formatReps: collapses uniform ranges, joins mixed, passes reps_target through", () => {
    const uniform = exercise({
      setSpecs: [working(1, { reps_min: 8, reps_max: 10 }), working(2, { reps_min: 8, reps_max: 10 })],
    });
    expect(formatReps(uniform)).toBe("8–10");
    const mixed = exercise({
      setSpecs: [
        working(1, { reps_min: 8, reps_max: 10 }),
        working(2, { reps_min: 5 }),
        working(3, { reps_target: "AMRAP" }),
      ],
    });
    expect(formatReps(mixed)).toBe("8–10 / 5+ / AMRAP");
  });

  it("formatSetCount: counts working-type sets only — not warm-ups, drops or sets to failure — singular for one", () => {
    const ex = exercise({
      setSpecs: [
        { set_number: 1, set_type: "warmup" },
        working(2),
        { set_number: 3, set_type: "drop" },
        { set_number: 4, set_type: "failure" },
      ],
    });
    expect(formatSetCount(ex)).toBe("1 set");
    expect(formatSetCount(exercise({ sets: 4 }))).toBe("4 sets");
  });
});
