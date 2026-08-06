import { describe, it, expect } from "vitest";
import type { Exercise } from "@/types/training";
import type { SetSpec } from "@/utils/exercise-set-specs";
import { progressWeek } from "./program-builder-model";
import { makeRestWeek, type ExerciseDraft, type WeekDraft } from "./program-builder-types";
import {
  buildIsCompound,
  buildPreviewRows,
  formatLoads,
  formatReps,
  formatSetCount,
} from "./progression-preview-model";

function catalogEntry(over: Partial<Exercise> = {}): Exercise {
  return {
    id: "e-bench",
    coachId: null,
    name: "Bench Press",
    muscleGroup: "chest",
    equipment: "barbell",
    category: "compound",
    aliases: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

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
    supersetGroup: null,
    isWarmup: false,
    notes: null,
    videoUrl: null,
    ...over,
  };
}

const working = (n: number, over: Partial<SetSpec> = {}): SetSpec => ({
  set_number: n,
  set_type: "working",
  ...over,
});

describe("buildIsCompound", () => {
  const isCompound = buildIsCompound([
    catalogEntry({ id: "e-bench", name: "Bench Press", category: "Compound" }), // mixed case on purpose
    catalogEntry({ id: "e-curl", name: "Cable Curl", category: "isolation" }),
  ]);

  it("classifies by exerciseId when resolved (case-insensitive category)", () => {
    expect(isCompound({ exerciseId: "e-bench", name: "renamed" })).toBe(true);
    expect(isCompound({ exerciseId: "e-curl", name: "Cable Curl" })).toBe(false);
  });

  it("falls back to lowercased trimmed name for free-text exercises", () => {
    expect(isCompound({ exerciseId: null, name: "  bench press " })).toBe(true);
  });

  it("unknown exercises are not compound", () => {
    expect(isCompound({ exerciseId: "e-mystery", name: "Mystery" })).toBe(false);
    expect(isCompound({ exerciseId: null, name: "Mystery" })).toBe(false);
  });
});

describe("diff formatters (working sets only)", () => {
  it("formatLoads: uniform absolute loads share one kg suffix", () => {
    const ex = exercise({
      setSpecs: [
        { set_number: 1, set_type: "warmup", load_type: "absolute", load_value: 60 },
        working(2, { load_type: "absolute", load_value: 100 }),
        working(3, { load_type: "absolute", load_value: 90 }),
      ],
    });
    expect(formatLoads(ex, "metric")).toBe("100 / 90 kg");
  });

  it("formatLoads: uniform percent loads use per-token %", () => {
    const ex = exercise({
      setSpecs: [
        working(1, { load_type: "pct_1rm", load_value: 70 }),
        working(2, { load_type: "pct_top", load_value: 85 }),
      ],
    });
    expect(formatLoads(ex, "metric")).toBe("70% / 85%");
  });

  it("formatLoads: mixed/missing loads fall back to per-token units", () => {
    const ex = exercise({
      setSpecs: [
        working(1, { load_type: "absolute", load_value: 100 }),
        working(2, { load_type: "pct_1rm", load_value: 70 }),
        working(3),
      ],
    });
    expect(formatLoads(ex, "metric")).toBe("100kg / 70% / —");
  });

  it("formatLoads: compact-only exercise renders its synthesized specs", () => {
    expect(formatLoads(exercise({ percentage1rm: 75 }), "metric")).toBe("75% / 75% / 75%");
    expect(formatLoads(exercise(), "metric")).toBe("— / — / —");
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

  it("formatSetCount: counts working sets only, singular for one", () => {
    const ex = exercise({
      setSpecs: [
        { set_number: 1, set_type: "warmup" },
        working(2),
        { set_number: 3, set_type: "drop" },
      ],
    });
    // drop counts as non-working for progression display: working-TYPE only
    expect(formatSetCount(ex)).toBe("1 set");
    expect(formatSetCount(exercise({ sets: 4 }))).toBe("4 sets");
  });
});

describe("buildPreviewRows", () => {
  function sourceWeek(): WeekDraft {
    const week = makeRestWeek(0);
    week.days[2] = {
      ...week.days[2],
      isRest: false,
      session: {
        uid: "sess-push",
        name: "Push",
        focus: null,
        estimatedDurationMinutes: null,
        calorieSurplusPercentage: null,
        notes: null,
        sessionType: "training",
        exercises: [
          exercise({
            uid: "ex-bench",
            setSpecs: [working(1, { load_type: "absolute", load_value: 100 })],
          }),
          exercise({
            uid: "ex-curl",
            exerciseId: null,
            name: "Cable Curl",
            setSpecs: [working(1, { load_type: "pct_1rm", load_value: 60 })],
          }),
        ],
      },
    };
    return week;
  }

  it("pairs source and progressed exercises positionally with changed flags + diffs", () => {
    const source = sourceWeek();
    const rule = { kind: "load", mode: "absolute", amount: 2.5 } as const;
    const { week: progressed, changedExerciseUids } = progressWeek(source, rule, () => true);
    const days = buildPreviewRows(source, progressed, changedExerciseUids, rule, "metric");

    expect(days).toHaveLength(1); // rest days emit nothing
    expect(days[0].dayIndex).toBe(2);
    expect(days[0].sessionName).toBe("Push");
    const [bench, curl] = days[0].rows;
    expect(bench).toMatchObject({
      name: "Bench Press",
      scopeKey: "e-bench",
      changed: true,
      before: "100 kg",
      after: "102.5 kg",
    });
    // pct-loaded curl is untouched by the kg rule
    expect(curl).toMatchObject({
      name: "Cable Curl",
      scopeKey: "cable curl",
      changed: false,
      after: null,
    });
    // row uid is the CLONE's uid so checkbox state survives commit-side lookups
    expect(bench.uid).toBe(progressed.days[2].session!.exercises[0].uid);
  });
});

// formatLoads is the fork point between the coach-facing preview dialog and the
// model-facing assistant tools. The assistant pins "metric" deliberately (see
// draft-week-tools.ts) because it speaks canonical kilograms everywhere.
describe("formatLoads — viewer fork", () => {
  it("renders absolute loads in the viewer's unit, snapped for imperial", () => {
    const ex = exercise({
      setSpecs: [
        { set_number: 1, load_type: "absolute", load_value: 100 },
        { set_number: 2, load_type: "absolute", load_value: 100 },
      ] as never,
    });

    expect(formatLoads(ex, "metric")).toBe("100 / 100 kg");
    // 100 kg is 220.46 lbs; formatLoad snaps to a loadable 5 lb increment.
    expect(formatLoads(ex, "imperial")).toBe("220 / 220 lbs");
  });

  it("leaves percentage loads untouched for both viewers", () => {
    const ex = exercise({ percentage1rm: 75 });
    expect(formatLoads(ex, "imperial")).toBe(formatLoads(ex, "metric"));
  });
});
