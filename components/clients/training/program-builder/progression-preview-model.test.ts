import { describe, it, expect } from "vitest";
import type { Exercise } from "@/types/training";
import type { SetSpec } from "@/utils/exercise-set-specs";
import { STRAIGHT_SETS, sessionExercises } from "@/utils/exercise-groups";
import { progressWeek } from "./program-builder-model";
import {
  makeRestWeek,
  type ExerciseDraft,
  type ExerciseGroupDraft,
  type WeekDraft,
} from "./program-builder-types";
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
    exerciseType: "strength",
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
        { set_number: 1, set_type: "warmup", load_type: "absolute", load_min: 60, load_max: 60 },
        working(2, { load_type: "absolute", load_min: 100, load_max: 100 }),
        working(3, { load_type: "absolute", load_min: 90, load_max: 90 }),
      ],
    });
    expect(formatLoads(ex, "metric")).toBe("100 / 90 kg");
  });

  it("formatLoads: uniform percent loads use per-token %", () => {
    const ex = exercise({
      setSpecs: [
        working(1, { load_type: "pct_1rm", load_min: 70, load_max: 70 }),
        working(2, { load_type: "pct_top", load_min: 85, load_max: 85 }),
      ],
    });
    expect(formatLoads(ex, "metric")).toBe("70% / 85%");
  });

  it("formatLoads: mixed/missing loads fall back to per-token units", () => {
    const ex = exercise({
      setSpecs: [
        working(1, { load_type: "absolute", load_min: 100, load_max: 100 }),
        working(2, { load_type: "pct_1rm", load_min: 70, load_max: 70 }),
        working(3),
      ],
    });
    expect(formatLoads(ex, "metric")).toBe("100kg / 70% / —");
  });

  it("formatLoads: equal working sets collapse to one value, as reps do", () => {
    const ex = exercise({
      setSpecs: [
        { set_number: 1, set_type: "working", load_type: "absolute", load_min: 100, load_max: 105 },
        { set_number: 2, set_type: "working", load_type: "absolute", load_min: 100, load_max: 105 },
      ],
    });
    expect(formatLoads(ex, "metric")).toBe("100–105 kg");
  });

  it("formatLoads: compact-only exercise renders its synthesized specs", () => {
    expect(formatLoads(exercise({ percentage1rm: 75 }), "metric")).toBe("75%");
    expect(formatLoads(exercise(), "metric")).toBe("—");
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
  // A lone exercise: a straight-sets group of one.
  const lone = (ex: ExerciseDraft): ExerciseGroupDraft => ({
    uid: `grp-${ex.uid}`,
    ...STRAIGHT_SETS,
    exercises: [ex],
  });

  function sourceWeek(): WeekDraft {
    const week = makeRestWeek(0);
    week.days[2] = {
      ...week.days[2],
      isRest: false,
      sessions: [
        {
          uid: "sess-push",
          name: "Push",
          focus: null,
          estimatedDurationMinutes: null,
          calorieSurplusPercentage: null,
          notes: null,
          sessionType: "training",
          groups: [
            lone(
              exercise({
                uid: "ex-bench",
                setSpecs: [working(1, { load_type: "absolute", load_min: 100, load_max: 100 })],
              }),
            ),
            lone(
              exercise({
                uid: "ex-curl",
                exerciseId: null,
                name: "Cable Curl",
                setSpecs: [working(1, { load_type: "pct_1rm", load_min: 60, load_max: 60 })],
              }),
            ),
          ],
        },
      ],
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
    expect(days[0].place).toBe(0);
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
    expect(bench.uid).toBe(sessionExercises(progressed.days[2].sessions[0])[0].uid);
  });

  it("gives each session of a day its own entry, paired by its place in the day", () => {
    const source = sourceWeek();
    const [push] = source.days[2].sessions;
    source.days[2] = {
      ...source.days[2],
      sessions: [
        push,
        {
          ...push,
          uid: "sess-pull",
          name: "Pull",
          groups: [
            lone(
              exercise({
                uid: "ex-row",
                name: "Row",
                setSpecs: [working(1, { load_type: "absolute", load_min: 70, load_max: 70 })],
              }),
            ),
          ],
        },
      ],
    };
    const rule = { kind: "load", mode: "absolute", amount: 5 } as const;
    const { week: progressed, changedExerciseUids } = progressWeek(source, rule, () => true);
    const entries = buildPreviewRows(source, progressed, changedExerciseUids, rule, "metric");

    expect(entries.map((e) => [e.dayIndex, e.place, e.sessionName])).toEqual([
      [2, 0, "Push"],
      [2, 1, "Pull"],
    ]);
    expect(entries[1].rows).toEqual([
      expect.objectContaining({
        name: "Row",
        changed: true,
        before: "70 kg",
        after: "75 kg",
        uid: sessionExercises(progressed.days[2].sessions[1])[0].uid,
      }),
    ]);
  });

  it("reads a superset's Sets change as rounds, for every exercise in it", () => {
    const source = sourceWeek();
    const [session] = source.days[2].sessions;
    source.days[2] = {
      ...source.days[2],
      sessions: [
        {
          ...session,
          groups: [
            {
              uid: "grp-superset",
              ...STRAIGHT_SETS,
              format: "circuit",
              rounds: 3,
              exercises: session.groups.map((g) => ({ ...g.exercises[0], setSpecs: null, sets: 3 })),
            },
          ],
        },
      ],
    };
    const rule = { kind: "sets", amount: 1 } as const;
    // Only the bench is in scope; the curl's rounds change with it.
    const { week: progressed, changedExerciseUids } = progressWeek(
      source,
      rule,
      (ex) => ex.name === "Bench Press",
    );
    const [bench, curl] = buildPreviewRows(source, progressed, changedExerciseUids, rule, "metric")[0].rows;
    expect(bench).toMatchObject({ changed: true, before: "3 rounds", after: "4 rounds" });
    expect(curl).toMatchObject({ changed: true, before: "3 rounds", after: "4 rounds" });
  });
});

// formatLoads is the fork point between the coach-facing preview dialog and the
// model-facing assistant tools. The assistant pins "metric" deliberately (see
// draft-week-tools.ts) because it speaks canonical kilograms everywhere.
describe("formatLoads — viewer fork", () => {
  it("renders absolute loads in the viewer's unit, snapped for imperial", () => {
    const ex = exercise({
      setSpecs: [
        { set_number: 1, load_type: "absolute", load_min: 100, load_max: 100 },
        { set_number: 2, load_type: "absolute", load_min: 100, load_max: 100 },
      ] as never,
    });

    expect(formatLoads(ex, "metric")).toBe("100 kg");
    // 100 kg is 220.46 lbs; formatLoad snaps to a loadable 5 lb increment.
    expect(formatLoads(ex, "imperial")).toBe("220 lbs");
  });

  it("leaves percentage loads untouched for both viewers", () => {
    const ex = exercise({ percentage1rm: 75 });
    expect(formatLoads(ex, "imperial")).toBe(formatLoads(ex, "metric"));
  });
});
