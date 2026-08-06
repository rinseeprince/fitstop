import { describe, it, expect } from "vitest";
import {
  buildScopePredicate,
  exerciseScopeKey,
  progressExercise,
  progressSetSpecs,
  type ProgressionExercise,
  type ProgressionRule,
} from "./progression-rules";
import { compactFromSpecs, type SetSpec } from "./exercise-set-specs";
import {
  cloneWeek,
  progressWeek,
} from "@/components/clients/training/program-builder/program-builder-model";
import {
  makeRestWeek,
  type ExerciseDraft,
  type WeekDraft,
} from "@/components/clients/training/program-builder/program-builder-types";

function spec(setType: SetSpec["set_type"], setNumber: number, over: Partial<SetSpec> = {}): SetSpec {
  return { set_number: setNumber, set_type: setType, ...over };
}

function absWorking(setNumber: number, load: number, over: Partial<SetSpec> = {}): SetSpec {
  return spec("working", setNumber, { load_type: "absolute", load_value: load, ...over });
}

function exercise(over: Partial<ProgressionExercise> = {}): ProgressionExercise {
  return {
    exerciseId: "ex-cat-1",
    name: "Bench Press",
    isWarmup: false,
    setSpecs: null,
    sets: 3,
    repsMin: 8,
    repsMax: 12,
    repsTarget: null,
    rpeTarget: null,
    percentage1rm: null,
    tempo: null,
    restSeconds: null,
    ...over,
  };
}

const kg = (amount: number): ProgressionRule => ({ kind: "load", mode: "absolute", amount });
const pct = (amount: number): ProgressionRule => ({ kind: "load", mode: "percent", amount });
const reps = (amount: number): ProgressionRule => ({ kind: "reps", amount });
const sets = (amount: number): ProgressionRule => ({ kind: "sets", amount });

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

const snapshot = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("progressSetSpecs — load kg", () => {
  it("adds kg to absolute working loads only; every other spec keeps its reference", () => {
    const specs = [
      spec("warmup", 1, { load_type: "absolute", load_value: 60 }),
      absWorking(2, 100),
      spec("working", 3, { load_type: "pct_1rm", load_value: 70 }),
      spec("drop", 4, { load_type: "absolute", load_value: 80 }),
      spec("amrap", 5, { load_type: "absolute", load_value: 90 }),
    ];
    const next = progressSetSpecs(specs, kg(2.5))!;
    expect(next[1].load_value).toBe(102.5);
    // warmup / pct working / drop / amrap: untouched by reference
    expect(next[0]).toBe(specs[0]);
    expect(next[2]).toBe(specs[2]);
    expect(next[3]).toBe(specs[3]);
    expect(next[4]).toBe(specs[4]);
  });

  it("treats a spec with MISSING set_type as working (countWorkingSets convention)", () => {
    const untyped = { set_number: 1, load_type: "absolute", load_value: 100 } as SetSpec;
    const next = progressSetSpecs([untyped], kg(2.5))!;
    expect(next[0].load_value).toBe(102.5);
  });

  it("never fabricates a load_type: load_value with load_type null is skipped by BOTH load rules", () => {
    const specs = [spec("working", 1, { load_type: null, load_value: 100 })];
    expect(progressSetSpecs(specs, kg(2.5))).toBeNull();
    expect(progressSetSpecs(specs, pct(2.5))).toBeNull();
  });

  it("scrubs float dust to 2dp", () => {
    const next = progressSetSpecs([absWorking(1, 1.1)], kg(2.2))!;
    expect(next[0].load_value).toBe(3.3);
  });

  it("clamps to [0, 2000]", () => {
    expect(progressSetSpecs([absWorking(1, 1999)], kg(5))![0].load_value).toBe(2000);
    expect(progressSetSpecs([absWorking(1, 2)], kg(-5))![0].load_value).toBe(0);
  });

  it("returns null when no working set carries an absolute load", () => {
    const specs = [
      spec("working", 1, { load_type: "pct_1rm", load_value: 70 }),
      spec("working", 2), // no load at all
    ];
    expect(progressSetSpecs(specs, kg(2.5))).toBeNull();
  });
});

describe("progressSetSpecs — load percent", () => {
  it("multiplies absolute loads and snaps to the nearest 0.5 kg", () => {
    const next = progressSetSpecs([absWorking(1, 100), absWorking(2, 72.5)], pct(2.5))!;
    expect(next[0].load_value).toBe(102.5);
    expect(next[1].load_value).toBe(74.5); // 74.3125 -> nearest 0.5
  });

  it("adds percentage points to pct_1rm and pct_top loads, 1dp", () => {
    const specs = [
      spec("working", 1, { load_type: "pct_1rm", load_value: 70 }),
      spec("working", 2, { load_type: "pct_top", load_value: 85 }),
    ];
    const next = progressSetSpecs(specs, pct(2.5))!;
    expect(next[0].load_value).toBe(72.5);
    expect(next[1].load_value).toBe(87.5);
  });

  it("clamps pct loads at 100", () => {
    const specs = [spec("working", 1, { load_type: "pct_1rm", load_value: 97.5 })];
    expect(progressSetSpecs(specs, pct(5))![0].load_value).toBe(100);
  });

  it("a snap-back-to-same is a genuine no-op (null)", () => {
    // 20 * 1.01 = 20.2 -> nearest 0.5 -> 20 again
    expect(progressSetSpecs([absWorking(1, 20)], pct(1))).toBeNull();
  });

  it("negative percent deloads both load styles", () => {
    const specs = [absWorking(1, 100), spec("working", 2, { load_type: "pct_1rm", load_value: 70 })];
    const next = progressSetSpecs(specs, pct(-2.5))!;
    expect(next[0].load_value).toBe(97.5);
    expect(next[1].load_value).toBe(67.5);
  });

  it("never scales drops[].weight under either load rule", () => {
    const drops = [{ weight: 80, reps: 8 }];
    const specs = [absWorking(1, 100, { drops })];
    const afterPct = progressSetSpecs(specs, pct(10))!;
    expect(afterPct[0].load_value).toBe(110);
    expect(afterPct[0].drops).toBe(drops); // same reference, values untouched
    const afterKg = progressSetSpecs(specs, kg(10))!;
    expect(afterKg[0].drops).toBe(drops);
    expect(drops[0].weight).toBe(80);
  });
});

describe("progressSetSpecs — reps", () => {
  it("bumps reps_min/reps_max on working sets; warm-up reps untouched by reference", () => {
    const specs = [
      spec("warmup", 1, { reps_min: 10, reps_max: 12 }),
      spec("working", 2, { reps_min: 8, reps_max: 10 }),
    ];
    const next = progressSetSpecs(specs, reps(1))!;
    expect(next[0]).toBe(specs[0]);
    expect(next[1].reps_min).toBe(9);
    expect(next[1].reps_max).toBe(11);
  });

  it("handles one-sided ranges", () => {
    const next = progressSetSpecs(
      [spec("working", 1, { reps_min: 5 }), spec("working", 2, { reps_max: 10 })],
      reps(2),
    )!;
    expect(next[0].reps_min).toBe(7);
    expect(next[0].reps_max).toBeUndefined();
    expect(next[1].reps_max).toBe(12);
  });

  it("clamps to the zod bound [0,100] preserving min <= max", () => {
    const up = progressSetSpecs([spec("working", 1, { reps_min: 98, reps_max: 99 })], reps(5))!;
    expect(up[0].reps_min).toBe(100);
    expect(up[0].reps_max).toBe(100);
    const down = progressSetSpecs([spec("working", 1, { reps_min: 2, reps_max: 4 })], reps(-3))!;
    expect(down[0].reps_min).toBe(0);
    expect(down[0].reps_max).toBe(1);
  });

  it("leaves reps_target free text untouched; a target-only prescription is a no-op", () => {
    const specs = [spec("working", 1, { reps_target: "AMRAP" })];
    expect(progressSetSpecs(specs, reps(2))).toBeNull();
    const mixed = [spec("working", 1, { reps_min: 8, reps_max: 10, reps_target: "8-10" })];
    expect(progressSetSpecs(mixed, reps(2))![0].reps_target).toBe("8-10");
  });

  it("rounds fractional amounts to integer reps", () => {
    const next = progressSetSpecs([spec("working", 1, { reps_min: 8, reps_max: 10 })], reps(1.5))!;
    expect(next[0].reps_min).toBe(10); // 9.5 -> 10
    expect(next[0].reps_max).toBe(12); // 11.5 -> 12
  });
});

describe("progressSetSpecs — sets", () => {
  it("appends clones of the LAST working set before trailing finishers, renumbered contiguously", () => {
    const specs = [
      spec("warmup", 1),
      absWorking(2, 100),
      absWorking(3, 90, { rpe_target: 8 }),
      spec("drop", 4, { load_type: "absolute", load_value: 70 }),
    ];
    const next = progressSetSpecs(specs, sets(2))!;
    expect(next).toHaveLength(6);
    // clones of the last WORKING set (index 2), inserted before the drop
    expect(next[3]).toMatchObject({ set_type: "working", load_value: 90, rpe_target: 8 });
    expect(next[4]).toMatchObject({ set_type: "working", load_value: 90 });
    expect(next[5].set_type).toBe("drop");
    expect(next.map((s) => s.set_number)).toEqual([1, 2, 3, 4, 5, 6]);
    // specs before the insertion point keep identity
    expect(next[0]).toBe(specs[0]);
    expect(next[1]).toBe(specs[1]);
    expect(next[2]).toBe(specs[2]);
  });

  it("deep-clones the template (drops are independent)", () => {
    const specs = [absWorking(1, 100, { drops: [{ weight: 80, reps: 8 }] })];
    const next = progressSetSpecs(specs, sets(1))!;
    expect(next[1].drops).toEqual([{ weight: 80, reps: 8 }]);
    expect(next[1].drops).not.toBe(specs[0].drops);
    next[1].drops![0].weight = 1;
    expect(specs[0].drops![0].weight).toBe(80);
  });

  it("partial-appends up to the joint headroom of both ceilings", () => {
    // 19 working sets: working headroom 1 even though total headroom is 11
    const nineteen = Array.from({ length: 19 }, (_, i) => absWorking(i + 1, 100));
    expect(progressSetSpecs(nineteen, sets(3))).toHaveLength(20);
    // 20 working sets: zero headroom -> null
    const twenty = Array.from({ length: 20 }, (_, i) => absWorking(i + 1, 100));
    expect(progressSetSpecs(twenty, sets(1))).toBeNull();
    // 29 total (10 warmups + 19 working): total headroom 1 -> appends exactly 1
    const twentyNine = [
      ...Array.from({ length: 10 }, (_, i) => spec("warmup", i + 1)),
      ...Array.from({ length: 19 }, (_, i) => absWorking(i + 11, 100)),
    ];
    expect(progressSetSpecs(twentyNine, sets(3))).toHaveLength(30);
  });

  it("fractional amounts between -1 and 1 are no-ops", () => {
    const specs = [absWorking(1, 100), absWorking(2, 100)];
    expect(progressSetSpecs(specs, sets(0))).toBeNull();
    expect(progressSetSpecs(specs, sets(0.5))).toBeNull();
    expect(progressSetSpecs(specs, sets(-0.5))).toBeNull();
  });

  it("no working set to clone -> null", () => {
    expect(progressSetSpecs([spec("warmup", 1), spec("amrap", 2)], sets(1))).toBeNull();
  });

  it("negative amounts remove the LAST working sets; warm-ups/finishers survive, renumbered", () => {
    const specs = [
      spec("warmup", 1),
      absWorking(2, 100), // top set — survives
      absWorking(3, 90),
      absWorking(4, 90),
      spec("drop", 5, { load_type: "absolute", load_value: 70 }),
    ];
    const next = progressSetSpecs(specs, sets(-1))!;
    expect(next.map((s) => [s.set_type, s.load_value])).toEqual([
      ["warmup", undefined],
      ["working", 100],
      ["working", 90],
      ["drop", 70],
    ]);
    expect(next.map((s) => s.set_number)).toEqual([1, 2, 3, 4]);
    // specs before the removal point keep identity
    expect(next[0]).toBe(specs[0]);
    expect(next[1]).toBe(specs[1]);
    expect(next[2]).toBe(specs[2]);
  });

  it("removal floors at one working set (partial removal) and no-ops at the floor", () => {
    const three = [absWorking(1, 100), absWorking(2, 90), absWorking(3, 90)];
    const floored = progressSetSpecs(three, sets(-5))!;
    expect(floored).toHaveLength(1);
    expect(floored[0].load_value).toBe(100); // the first working set survives
    expect(progressSetSpecs([absWorking(1, 100)], sets(-1))).toBeNull();
  });
});

describe("progressExercise", () => {
  it.each([kg(2.5), pct(2.5), reps(1), sets(1), sets(-1)])(
    "isWarmup exercise -> null for rule %j",
    (rule) => {
      const ex = exercise({ isWarmup: true, setSpecs: [absWorking(1, 100), absWorking(2, 90)] });
      expect(progressExercise(ex, rule)).toBeNull();
    },
  );

  it("compact-only + kg rule -> null (exercise stays compact; expand never emits absolute loads)", () => {
    expect(progressExercise(exercise(), kg(2.5))).toBeNull();
  });

  it("compact-only + sets rule materializes with a correct compact projection", () => {
    const result = progressExercise(exercise({ sets: 3 }), sets(2))!;
    expect(result.setSpecs).toHaveLength(5);
    expect(result.setSpecs.every((s) => s.set_type === "working")).toBe(true);
    expect(result.sets).toBe(5);
    expect(result.repsMin).toBe(8);
    expect(result.repsMax).toBe(12);
  });

  it("compact-only + negative sets rule materializes the reduced prescription", () => {
    const result = progressExercise(exercise({ sets: 3 }), sets(-1))!;
    expect(result.setSpecs).toHaveLength(2);
    expect(result.sets).toBe(2);
  });

  it("compact-only + percent rule keeps specs and percentage1rm in lockstep", () => {
    const result = progressExercise(exercise({ percentage1rm: 75 }), pct(2.5))!;
    expect(result.setSpecs.every((s) => s.load_value === 77.5)).toBe(true);
    expect(result.percentage1rm).toBe(77.5);
  });

  it("spec-bearing + percent rule mirrors percentage1rm; null passes through", () => {
    const specs = [spec("working", 1, { load_type: "pct_1rm", load_value: 70 })];
    const mirrored = progressExercise(exercise({ setSpecs: specs, percentage1rm: 70 }), pct(2.5))!;
    expect(mirrored.setSpecs[0].load_value).toBe(72.5);
    expect(mirrored.percentage1rm).toBe(72.5);
    const nullPct = progressExercise(exercise({ setSpecs: specs, percentage1rm: null }), pct(2.5))!;
    expect(nullPct.percentage1rm).toBeNull();
  });

  it.each([kg(2.5), pct(2.5), reps(1), sets(1), sets(-1)])(
    "result compact fields always equal compactFromSpecs(result.setSpecs) for rule %j",
    (rule) => {
      const ex = exercise({
        setSpecs: [
          spec("warmup", 1, { reps_min: 10, reps_max: 12 }),
          absWorking(2, 100, { reps_min: 5, reps_max: 8 }),
          spec("working", 3, { load_type: "pct_1rm", load_value: 70, reps_min: 8, reps_max: 10 }),
        ],
      });
      const result = progressExercise(ex, rule);
      if (!result) return; // rule was a no-op for this fixture — nothing to project
      const compact = compactFromSpecs(result.setSpecs);
      expect(result.sets).toBe(compact.sets);
      expect(result.repsMin).toBe(compact.repsMin);
      expect(result.repsMax).toBe(compact.repsMax);
    },
  );

  it("non-finite or zero amounts -> null (never poisons specs or the pct mirror)", () => {
    const ex = exercise({ setSpecs: [absWorking(1, 100)], percentage1rm: 70.25 });
    expect(progressExercise(ex, kg(0))).toBeNull();
    expect(progressExercise(ex, kg(Number.NaN))).toBeNull();
    expect(progressExercise(ex, pct(0))).toBeNull(); // rounding alone must not move percentage1rm
    expect(progressExercise(ex, pct(Number.POSITIVE_INFINITY))).toBeNull();
  });
});

describe("buildScopePredicate / exerciseScopeKey", () => {
  const bench = exercise({ exerciseId: "id-bench", name: "Bench Press" });
  const curl = exercise({ exerciseId: null, name: "  Cable Curl " });

  it("all matches everything", () => {
    const inScope = buildScopePredicate({ kind: "all" }, () => false);
    expect(inScope(bench)).toBe(true);
    expect(inScope(curl)).toBe(true);
  });

  it("compounds delegates to the injected classifier", () => {
    const inScope = buildScopePredicate({ kind: "compounds" }, (ex) => ex.name === "Bench Press");
    expect(inScope(bench)).toBe(true);
    expect(inScope(curl)).toBe(false);
  });

  it("selected matches exerciseId first, lowercased trimmed name as fallback; empty set matches nothing", () => {
    const inScope = buildScopePredicate(
      { kind: "selected", keys: new Set(["id-bench", "cable curl"]) },
      () => false,
    );
    expect(inScope(bench)).toBe(true);
    expect(inScope(curl)).toBe(true);
    const none = buildScopePredicate({ kind: "selected", keys: new Set() }, () => true);
    expect(none(bench)).toBe(false);
  });

  it("exerciseScopeKey: id wins over name; names are trimmed + lowercased", () => {
    expect(exerciseScopeKey(bench)).toBe("id-bench");
    expect(exerciseScopeKey(curl)).toBe("cable curl");
  });
});

describe("purity", () => {
  it.each([kg(2.5), pct(2.5), reps(1), sets(2), sets(-1)])(
    "deep-frozen inputs survive rule %j and deep-equal their pre-call snapshot",
    (rule) => {
      const ex = deepFreeze(
        exercise({
          percentage1rm: 75,
          setSpecs: [
            spec("warmup", 1),
            absWorking(2, 100, { reps_min: 8, reps_max: 10, drops: [{ weight: 80, reps: 8 }] }),
            spec("working", 3, { load_type: "pct_1rm", load_value: 70, reps_min: 8, reps_max: 10 }),
          ],
        }),
      );
      const before = snapshot(ex);
      progressExercise(ex, rule); // frozen inputs throw on any mutation attempt
      expect(ex).toEqual(before);
    },
  );
});

// ============================================================================
// progressWeek — the WeekDraft walk (program-builder-model), duplicate-week
// integration
// ============================================================================

function draftExercise(over: Partial<ExerciseDraft> = {}): ExerciseDraft {
  return {
    uid: `ex-${Math.random().toString(36).slice(2)}`,
    exerciseId: "id-bench",
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

function weekWithSessions(): WeekDraft {
  const week = makeRestWeek(0);
  week.days[0] = {
    ...week.days[0],
    isRest: false,
    session: {
      uid: "sess-push",
      name: "Push",
      focus: "Chest",
      estimatedDurationMinutes: 60,
      calorieSurplusPercentage: 12,
      notes: null,
      sessionType: "training",
      exercises: [
        draftExercise({
          uid: "ex-bench",
          setSpecs: [
            spec("warmup", 1, { load_type: "absolute", load_value: 60 }),
            absWorking(2, 100),
            absWorking(3, 90),
          ],
        }),
        draftExercise({
          uid: "ex-curl",
          exerciseId: null,
          name: "Cable Curl",
          setSpecs: [spec("working", 1, { load_type: "pct_1rm", load_value: 60 })],
        }),
      ],
    },
  };
  return week;
}

describe("progressWeek (duplicate-week integration)", () => {
  const isCompound = (ex: { name: string }) => ex.name === "Bench Press";

  it("prior weeks are byte-identical after progressing a duplicated week", () => {
    const weeks = [weekWithSessions(), makeRestWeek(1)];
    const before = JSON.stringify(weeks);
    const beforeDeep = snapshot(weeks);
    const { week: progressed } = progressWeek(
      cloneWeek(weeks[0]),
      kg(2.5),
      buildScopePredicate({ kind: "all" }, isCompound),
    );
    expect(JSON.stringify(weeks)).toBe(before);
    expect(weeks).toEqual(beforeDeep);
    // and the progressed clone actually changed
    expect(progressed.days[0].session!.exercises[0].setSpecs![1].load_value).toBe(102.5);
  });

  it("'+2.5 kg, compounds only': bench changes, curl keeps its reference, uids are the clone's", () => {
    const source = weekWithSessions();
    const clone = cloneWeek(source);
    const { week: progressed, changedExerciseUids } = progressWeek(
      clone,
      kg(2.5),
      buildScopePredicate({ kind: "compounds" }, isCompound),
    );
    const [bench, curl] = progressed.days[0].session!.exercises;
    expect(bench.setSpecs![1].load_value).toBe(102.5);
    expect(bench.setSpecs![2].load_value).toBe(92.5);
    expect(bench.setSpecs![0].load_value).toBe(60); // warm-up untouched
    expect(curl).toBe(clone.days[0].session!.exercises[1]); // out of scope: same reference
    expect(changedExerciseUids).toEqual(new Set([clone.days[0].session!.exercises[0].uid]));
    // surplus reconciliation: the session's surplus passes through untouched
    expect(progressed.days[0].session!.calorieSurplusPercentage).toBe(12);
  });

  it("a week the rule cannot change returns the INPUT reference and an empty set", () => {
    const source = weekWithSessions();
    // kg rule scoped to the pct-loaded curl only -> nothing changes
    const { week, changedExerciseUids } = progressWeek(
      source,
      kg(2.5),
      buildScopePredicate({ kind: "selected", keys: new Set(["cable curl"]) }, isCompound),
    );
    expect(week).toBe(source);
    expect(changedExerciseUids.size).toBe(0);
  });

  it("rest slots pass through by reference", () => {
    const source = weekWithSessions();
    const { week } = progressWeek(
      source,
      kg(2.5),
      buildScopePredicate({ kind: "all" }, isCompound),
    );
    for (let i = 1; i < 7; i++) {
      expect(week.days[i]).toBe(source.days[i]);
    }
  });
});
