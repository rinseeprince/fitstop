import { describe, it, expect } from "vitest";
import type {
  SavedPlan,
  SavedSession,
  SavedExercise,
  SavedExerciseGroup,
} from "@/types/training";
import type { SetSpec } from "@/utils/exercise-set-specs";
import {
  STRAIGHT_SETS,
  groupSettingsOf,
  sessionExercises,
  type GroupSettings,
} from "@/utils/exercise-groups";
import {
  createStandaloneSessionSchema,
  inlinePlanBodySchema,
  overwriteSavedPlanSchema,
} from "@/lib/validations/training";
import {
  savedPlanToDraft,
  draftToOverwriteBody,
  draftToInlinePlanBody,
  savedSessionToDraft,
  sessionDraftToStandalonePayload,
} from "./program-builder-serialize";
import { makeRestWeek, type ProgramDraft } from "./program-builder-types";

// =============================================================================
// Fixtures
// =============================================================================

const SPECS: SetSpec[] = [
  {
    set_number: 1,
    set_type: "warmup",
    reps_min: 10,
    reps_max: 12,
    reps_target: null,
    load_type: null,
    load_value: null,
    rpe_target: null,
    tempo: null,
    rest_seconds: 60,
    drops: null,
  },
  {
    set_number: 2,
    set_type: "working",
    reps_min: 8,
    reps_max: 10,
    reps_target: null,
    load_type: "pct_1rm",
    load_value: 75,
    rpe_target: 8,
    tempo: "3010",
    rest_seconds: 120,
    drops: null,
  },
  {
    set_number: 3,
    set_type: "drop",
    reps_min: null,
    reps_max: null,
    reps_target: "8+",
    load_type: "absolute",
    load_value: 60,
    rpe_target: 9.5,
    tempo: null,
    rest_seconds: 90,
    drops: [
      { weight: 50, reps: 8 },
      { weight: 40, reps: 8 },
    ],
  },
];

function makeExercise(overrides: Partial<SavedExercise> = {}): SavedExercise {
  return {
    id: "ex-row-1",
    savedSessionId: "sess-row-1",
    groupId: "group-row-1",
    exerciseId: "cat-1",
    name: "Bench Press",
    orderIndex: 0,
    sets: 2,
    repsMin: 8,
    repsMax: 10,
    repsTarget: null,
    rpeTarget: 8,
    percentage1rm: null,
    tempo: null,
    restSeconds: 120,
    isWarmup: false,
    notes: "Pause on chest",
    setSpecs: null,
    videoUrl: "https://example.com/bench",
    prescribedFields: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** A library group row at `orderIndex`, holding `exercises` in order. */
function makeGroup(
  id: string,
  orderIndex: number,
  settings: GroupSettings,
  exercises: SavedExercise[],
): SavedExerciseGroup {
  return {
    id,
    savedSessionId: "sess-row-1",
    orderIndex,
    ...settings,
    exercises: exercises.map((e, i) => ({ ...e, groupId: id, orderIndex: i })),
  };
}

/** Lone exercises: each a straight-sets group of one, in order. */
function lones(...exercises: SavedExercise[]): SavedExerciseGroup[] {
  return exercises.map((e, i) => makeGroup(`group-${e.id}`, i, STRAIGHT_SETS, [e]));
}

function makeSession(overrides: Partial<SavedSession> = {}): SavedSession {
  return {
    id: "sess-row-1",
    coachId: "coach-1",
    savedPlanId: "plan-1",
    name: "Push",
    focus: "chest",
    orderIndex: 0,
    weekIndex: 0,
    isRest: false,
    estimatedDurationMinutes: 60,
    calorieSurplusPercentage: 10,
    notes: null,
    sessionType: "training",
    groups: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeRestRow(weekIndex: number, orderIndex: number): SavedSession {
  return makeSession({
    id: `rest-${weekIndex}-${orderIndex}`,
    name: "Rest",
    focus: null,
    weekIndex,
    orderIndex,
    isRest: true,
    estimatedDurationMinutes: null,
    calorieSurplusPercentage: null,
    groups: [],
  });
}

function makePlan(overrides: Partial<SavedPlan> = {}): SavedPlan {
  return {
    id: "plan-1",
    coachId: "coach-1",
    name: "Test Program",
    description: "A program",
    splitType: "custom",
    frequencyPerWeek: 2,
    status: "saved",
    defaultSurplusPercentage: 12.5,
    source: "manual",
    coachPrompt: null,
    programDurationWeeks: null,
    sessions: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** A week-shaped plan: 7 rows per week, rest rows materialized, global orderIndex. */
function makeWeekShapedPlan(weekCount: number): SavedPlan {
  const sessions: SavedSession[] = [];
  for (let w = 0; w < weekCount; w++) {
    for (let d = 0; d < 7; d++) {
      const orderIndex = w * 7 + d;
      if (d === 0 || d === 3) {
        sessions.push(
          makeSession({
            id: `train-${w}-${d}`,
            name: d === 0 ? `Push W${w + 1}` : `Pull W${w + 1}`,
            weekIndex: w,
            orderIndex,
            calorieSurplusPercentage: d === 0 ? 10 : null,
            groups:
              d === 0
                ? lones(
                    makeExercise({ setSpecs: SPECS, sets: 2, repsMin: 8, repsMax: 10 }),
                    makeExercise({
                      id: "ex-row-2",
                      exerciseId: null,
                      name: "Cable Fly",
                      sets: 3,
                      rpeTarget: null,
                      notes: null,
                      videoUrl: null,
                      prescribedFields: null,
                    }),
                  )
                : [],
          }),
        );
      } else {
        sessions.push(makeRestRow(w, orderIndex));
      }
    }
  }
  return makePlan({ sessions });
}

const nonRestNames = (body: ReturnType<typeof draftToOverwriteBody>) =>
  body.sessions.filter((s) => !s.isRest).map((s) => s.name);
const restPositions = (body: ReturnType<typeof draftToOverwriteBody>) =>
  body.sessions.map((s, i) => (s.isRest ? i : -1)).filter((i) => i >= 0);

// =============================================================================
// Tier 1 — week-shaped plans round-trip byte-identically
// =============================================================================

describe("savedPlanToDraft / draftToOverwriteBody parity (week-shaped)", () => {
  it("round-trips a 2-week plan field-for-field with global orderIndex", () => {
    const plan = makeWeekShapedPlan(2);
    // Scramble input order — the serializer must sort by (weekIndex, orderIndex).
    const scrambled = makePlan({ sessions: [...plan.sessions].reverse() });
    const body = draftToOverwriteBody(savedPlanToDraft(scrambled));

    expect(body.name).toBe("Test Program");
    expect(body.description).toBe("A program");
    // The free-text focus persists on save (it's editable in the header now).
    expect(body.splitType).toBe("custom");
    expect(body.defaultSurplusPercentage).toBe(12.5);
    expect(body.sessions).toHaveLength(14);

    body.sessions.forEach((s, i) => {
      expect(s.orderIndex).toBe(i);
      expect(s.weekIndex).toBe(Math.floor(i / 7));
      // isRest is REQUIRED by the zod schema — explicitly false on training rows.
      expect(typeof s.isRest).toBe("boolean");
    });

    const day0 = body.sessions[0];
    expect(day0).toEqual({
      name: "Push W1",
      focus: "chest",
      orderIndex: 0,
      weekIndex: 0,
      isRest: false,
      estimatedDurationMinutes: 60,
      calorieSurplusPercentage: 10,
      notes: null,
      sessionType: "training",
      groups: [
        {
          ...STRAIGHT_SETS,
          exercises: [
            {
              name: "Bench Press",
              exerciseId: "cat-1",
              sets: 2,
              repsMin: 8,
              repsMax: 10,
              repsTarget: null,
              rpeTarget: 8,
              percentage1rm: null,
              tempo: null,
              restSeconds: 120,
              notes: "Pause on chest",
              isWarmup: false,
              setSpecs: SPECS,
              videoUrl: "https://example.com/bench",
              prescribedFields: null,
            },
          ],
        },
        {
          ...STRAIGHT_SETS,
          exercises: [
            {
              name: "Cable Fly",
              exerciseId: null,
              sets: 3,
              repsMin: 8,
              repsMax: 10,
              repsTarget: null,
              rpeTarget: null,
              percentage1rm: null,
              tempo: null,
              restSeconds: 120,
              notes: null,
              isWarmup: false,
              setSpecs: null,
              videoUrl: null,
              prescribedFields: null,
            },
          ],
        },
      ],
    });

    // Rest rows are real rows with an empty groups array and null surplus.
    const day1 = body.sessions[1];
    expect(day1.isRest).toBe(true);
    expect(day1.name).toBe("Rest");
    expect(day1.groups).toEqual([]);
    expect(day1.calorieSurplusPercentage).toBeNull();

    // Per-session surplus: set on W1 Push, inherited (null) on W1 Pull.
    expect(body.sessions[3].calorieSurplusPercentage).toBeNull();
    expect(body.sessions[3].name).toBe("Pull W1");
  });

  it("keeps setSpecs a verbatim passthrough (null stays null, no synthesis)", () => {
    const plan = makeWeekShapedPlan(1);
    const body = draftToOverwriteBody(savedPlanToDraft(plan));
    const [withSpecs, compactOnly] = sessionExercises(body.sessions[0]);
    expect(withSpecs.setSpecs).toEqual(SPECS);
    expect(compactOnly.setSpecs).toBeNull();
  });

  it("treats a single-week plan with materialized rest as week-shaped (no padding)", () => {
    const plan = makeWeekShapedPlan(1);
    const draft = savedPlanToDraft(plan);
    expect(draft.weeks).toHaveLength(1);
    expect(draft.weeks[0].days).toHaveLength(7);
    expect(draft.weeks[0].days.map((d) => d.isRest)).toEqual([
      false, true, true, false, true, true, true,
    ]);
  });
});

// =============================================================================
// Tier 2 — flat plans normalize into the week model (contract, not byte parity)
// =============================================================================

describe("savedPlanToDraft flat-plan normalization", () => {
  it("pads a flat no-rest list with trailing rest to a multiple of 7", () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      makeSession({ id: `s-${i}`, name: `S${i + 1}`, orderIndex: i }),
    );
    const plan = makePlan({ sessions });
    const body = draftToOverwriteBody(savedPlanToDraft(plan));

    expect(body.sessions).toHaveLength(14);
    expect(restPositions(body)).toEqual([10, 11, 12, 13]);
    expect(nonRestNames(body)).toEqual([
      "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10",
    ]);
  });

  it("normalizes a short week with materialized rest rows (non-7 count)", () => {
    // 5 rows, one an is_rest row: has the rest marker but not week shape.
    const sessions = [
      makeSession({ id: "s-0", name: "A", orderIndex: 0 }),
      makeSession({ id: "s-1", name: "B", orderIndex: 1 }),
      makeRestRow(0, 2),
      makeSession({ id: "s-3", name: "C", orderIndex: 3 }),
      makeSession({ id: "s-4", name: "D", orderIndex: 4 }),
    ];
    const plan = makePlan({ sessions });
    const body = draftToOverwriteBody(savedPlanToDraft(plan));

    expect(body.sessions).toHaveLength(7);
    expect(restPositions(body)).toEqual([2, 5, 6]);
    expect(nonRestNames(body)).toEqual(["A", "B", "C", "D"]);
  });

  it("yields one all-rest week for a plan with no sessions", () => {
    const draft = savedPlanToDraft(makePlan({ sessions: [] }));
    expect(draft.weeks).toHaveLength(1);
    expect(draft.weeks[0].days.every((d) => d.isRest && d.session === null)).toBe(true);
  });
});

// =============================================================================
// draftToOverwriteBody guards
// =============================================================================

describe("draftToOverwriteBody guards", () => {
  const baseDraft = (): ProgramDraft => ({
    id: "plan-1",
    name: "P",
    description: null,
    status: "saved",
    splitType: null,
    programDurationWeeks: null,
    defaultSurplusPercentage: null,
    weeks: [makeRestWeek(0)],
  });

  it("throws rather than serialize an empty sessions array", () => {
    const draft = { ...baseDraft(), weeks: [] };
    expect(() => draftToOverwriteBody(draft)).toThrow(/empty program/);
  });

  it("serializes an all-rest week as 7 real rest rows", () => {
    const body = draftToOverwriteBody(baseDraft());
    expect(body.sessions).toHaveLength(7);
    expect(body.sessions.every((s) => s.isRest && s.groups.length === 0)).toBe(true);
  });

  it("nullifies blank video URLs and empty setSpecs arrays", () => {
    const plan = makeWeekShapedPlan(1);
    const draft = savedPlanToDraft(plan);
    const slot = draft.weeks[0].days[0];
    const [ex1, ex2] = sessionExercises(slot.session!);
    ex1.videoUrl = "   ";
    ex2.setSpecs = []; // must never reach the API — fails the zod refine
    const body = draftToOverwriteBody(draft);
    const [out1, out2] = sessionExercises(body.sessions[0]);
    expect(out1.videoUrl).toBeNull();
    expect(out2.setSpecs).toBeNull();
  });

  it("truncates over-cap name/description instead of blocking the save (AI plans allow 200/1000)", () => {
    const draft = savedPlanToDraft(makeWeekShapedPlan(1));
    draft.name = "x".repeat(150);
    draft.description = "y".repeat(800);
    const body = draftToOverwriteBody(draft);
    expect(body.name).toHaveLength(100);
    expect(body.description).toHaveLength(500);
  });

  it("clamps exercise sets into the schema's 1..20 range", () => {
    const plan = makeWeekShapedPlan(1);
    const draft = savedPlanToDraft(plan);
    const [ex1, ex2] = sessionExercises(draft.weeks[0].days[0].session!);
    ex1.sets = 0;
    ex2.sets = 25;
    const body = draftToOverwriteBody(draft);
    const [out1, out2] = sessionExercises(body.sessions[0]);
    expect(out1.sets).toBe(1);
    expect(out2.sets).toBe(20);
  });
});

describe("savedSessionToDraft (library insert clone)", () => {
  it("clones with fresh uids, preserved exerciseId, normalized specs", () => {
    const saved = makeSession({
      name: "Push Day A",
      focus: "push",
      estimatedDurationMinutes: 45,
      calorieSurplusPercentage: 12,
      groups: lones(
        makeExercise({ id: "e-1", exerciseId: "cat-1", setSpecs: SPECS }),
        makeExercise({ id: "e-2", exerciseId: null, setSpecs: [] }),
      ),
    });

    const a = savedSessionToDraft(saved);
    const b = savedSessionToDraft(saved);
    const aExercises = sessionExercises(a);

    expect(a.uid).not.toBe(b.uid); // fresh identity per clone
    expect(a.name).toBe("Push Day A");
    // Surplus is a program/client decision, not a session-template attribute:
    // a dragged-in library session drops its own surplus and inherits the
    // program default wherever it lands.
    expect(a.calorieSurplusPercentage).toBeNull();
    expect(aExercises[0].exerciseId).toBe("cat-1");
    expect(aExercises[0].setSpecs).toEqual(SPECS);
    // [] specs normalize to null (an empty array would 400 the save).
    expect(aExercises[1].setSpecs).toBeNull();
    expect(aExercises[0].uid).not.toBe(sessionExercises(b)[0].uid);
  });
});

describe("sessionDraftToStandalonePayload (create-blank save)", () => {
  it("serializes with the same exercise mapping as the overwrite path", () => {
    const saved = makeSession({
      name: "Untitled session",
      focus: "legs",
      estimatedDurationMinutes: 40,
      calorieSurplusPercentage: 8,
      groups: lones(
        makeExercise({
          id: "e-1",
          exerciseId: "cat-9",
          setSpecs: SPECS,
          videoUrl: "  https://example.com/squat.mp4  ",
          prescribedFields: null,
        }),
      ),
    });
    const draft = savedSessionToDraft(saved);

    const payload = sessionDraftToStandalonePayload(draft);

    expect(payload.name).toBe("Untitled session");
    expect(payload.focus).toBe("legs");
    expect(payload.estimatedDurationMinutes).toBe(40);
    // A saved workout is a movement template — it carries no surplus (inherits
    // the program default wherever it's next placed).
    expect(payload.calorieSurplusPercentage).toBeNull();
    // Its position is its place: the first group's first exercise.
    expect(payload.groups).toHaveLength(1);
    expect(payload.groups[0].exercises).toHaveLength(1);
    expect(payload.groups[0].exercises[0]).toMatchObject({
      exerciseId: "cat-9",
      setSpecs: SPECS,
      videoUrl: "https://example.com/squat.mp4",
      prescribedFields: null, // trimmed
    });
  });

  it("caps the name at the create schema's 100 chars", () => {
    const draft = savedSessionToDraft(makeSession({ name: "x".repeat(150) }));
    expect(sessionDraftToStandalonePayload(draft).name).toHaveLength(100);
  });
});

// =============================================================================
// draftToInlinePlanBody (client-apply inline placement — Phase 5)
// =============================================================================

describe("draftToInlinePlanBody", () => {
  it("emits every slot with weekIndex + per-set data surviving verbatim", () => {
    const draft = savedPlanToDraft(makeWeekShapedPlan(2));
    const body = draftToInlinePlanBody(draft);

    expect(body.name).toBe("Test Program");
    expect(body.defaultSurplusPercentage).toBe(12.5);
    expect(body.sessions).toHaveLength(14);

    // Week-2 rows carry weekIndex 1; rest rows are real empty rows.
    const week2Push = body.sessions[7];
    expect(week2Push.weekIndex).toBe(1);
    expect(week2Push.name).toBe("Push W2");
    const rest = body.sessions[1];
    expect(rest.isRest).toBe(true);
    expect(rest.groups).toEqual([]);

    // The first exercise's per-set prescription survives byte-for-byte.
    const ex = sessionExercises(body.sessions[0])[0];
    expect(ex.setSpecs).toEqual(SPECS);
    expect(ex.videoUrl).toBe("https://example.com/bench");
    expect(ex.exerciseId).toBe("cat-1");
  });

  it("shares session serialization with the overwrite path (no drift)", () => {
    const draft = savedPlanToDraft(makeWeekShapedPlan(2));
    expect(draftToInlinePlanBody(draft).sessions).toEqual(
      draftToOverwriteBody(draft).sessions,
    );
  });

  it("carries the free-text program focus through verbatim", () => {
    // splitType is the free-text focus now — it rides onto the client's placed
    // plan; empty/null stays null.
    const base: Omit<ProgramDraft, "splitType"> = {
      id: "plan-1",
      name: "P",
      description: null,
      status: "saved",
      programDurationWeeks: null,
      defaultSurplusPercentage: null,
      weeks: [makeRestWeek(0)],
    };
    expect(
      draftToInlinePlanBody({ ...base, splitType: "Glute hypertrophy" }).splitType,
    ).toBe("Glute hypertrophy");
    expect(
      draftToInlinePlanBody({ ...base, splitType: "push_pull_legs" }).splitType,
    ).toBe("push_pull_legs");
    expect(draftToInlinePlanBody({ ...base, splitType: null }).splitType).toBeNull();
  });

  it("falls back to the week count when programDurationWeeks is null, else preserves it", () => {
    const fallback: ProgramDraft = {
      id: "plan-1",
      name: "P",
      description: null,
      status: "saved",
      splitType: null,
      programDurationWeeks: null,
      defaultSurplusPercentage: null,
      weeks: [makeRestWeek(0), makeRestWeek(1)],
    };
    expect(draftToInlinePlanBody(fallback).programDurationWeeks).toBe(2);

    const explicit: ProgramDraft = { ...fallback, programDurationWeeks: 5 };
    expect(draftToInlinePlanBody(explicit).programDurationWeeks).toBe(5);
  });
});

// =============================================================================
// Groups (migration 178) — every setting and exercise survives every write path
// =============================================================================

const SQUAT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROW_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BENCH_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

// A circuit with every setting set, so a dropped setting shows.
const CIRCUIT: GroupSettings = {
  format: "circuit",
  rounds: 3,
  timeCapSeconds: 900,
  intervalSeconds: 60,
  restBetweenExercisesSeconds: 15,
  restBetweenRoundsSeconds: 90,
  notes: "A",
};

/**
 * A circuit of Back Squat then Bent-over Row, then a lone Bench Press. Catalog
 * ids are uuids and video URLs http(s), so the write bodies can pass their
 * schemas.
 */
function makeGroupedSession(): SavedSession {
  return makeSession({
    groups: [
      makeGroup("saved-group-circuit", 0, CIRCUIT, [
        makeExercise({
          id: "ex-squat",
          exerciseId: SQUAT_ID,
          name: "Back Squat",
          sets: 2,
          repsMin: 8,
          repsMax: 10,
          repsTarget: "8-10",
          rpeTarget: 8,
          percentage1rm: 75,
          tempo: "3010",
          restSeconds: 120,
          notes: "Brace",
          setSpecs: SPECS,
          videoUrl: "https://example.com/squat",
          prescribedFields: ["set_type", "reps", "load"],
        }),
        makeExercise({
          id: "ex-row",
          exerciseId: ROW_ID,
          name: "Bent-over Row",
          sets: 3,
          repsMin: 10,
          repsMax: 12,
          rpeTarget: null,
          restSeconds: null,
          notes: null,
          videoUrl: null,
          prescribedFields: ["reps", "rpe"],
        }),
      ]),
      makeGroup("saved-group-bench", 1, STRAIGHT_SETS, [
        makeExercise({ id: "ex-bench", exerciseId: BENCH_ID }),
      ]),
    ],
  });
}

/** The groups every write body must carry for makeGroupedSession, in order. */
const GROUPED_INPUT = [
  {
    ...CIRCUIT,
    exercises: [
      {
        name: "Back Squat",
        exerciseId: SQUAT_ID,
        sets: 2,
        repsMin: 8,
        repsMax: 10,
        repsTarget: "8-10",
        rpeTarget: 8,
        percentage1rm: 75,
        tempo: "3010",
        restSeconds: 120,
        notes: "Brace",
        isWarmup: false,
        setSpecs: SPECS,
        videoUrl: "https://example.com/squat",
        prescribedFields: ["set_type", "reps", "load"],
      },
      {
        name: "Bent-over Row",
        exerciseId: ROW_ID,
        sets: 3,
        repsMin: 10,
        repsMax: 12,
        repsTarget: null,
        rpeTarget: null,
        percentage1rm: null,
        tempo: null,
        restSeconds: null,
        notes: null,
        isWarmup: false,
        setSpecs: null,
        videoUrl: null,
        prescribedFields: ["reps", "rpe"],
      },
    ],
  },
  {
    ...STRAIGHT_SETS,
    exercises: [
      {
        name: "Bench Press",
        exerciseId: BENCH_ID,
        sets: 2,
        repsMin: 8,
        repsMax: 10,
        repsTarget: null,
        rpeTarget: 8,
        percentage1rm: null,
        tempo: null,
        restSeconds: 120,
        notes: "Pause on chest",
        isWarmup: false,
        setSpecs: null,
        videoUrl: "https://example.com/bench",
        prescribedFields: null,
      },
    ],
  },
];

/** A position is an array place: no exercise input carries one, nor a superset label. */
function expectNoPositionFields(groups: ReadonlyArray<{ exercises: ReadonlyArray<object> }>) {
  for (const exercise of sessionExercises({ groups })) {
    expect(exercise).not.toHaveProperty("orderIndex");
    expect(exercise).not.toHaveProperty("supersetGroup");
  }
}

describe("groups through the serializers", () => {
  it("savedPlanToDraft builds the session's groups: settings kept, fresh grp- uids, exercises in group order", () => {
    const plan = makePlan({ sessions: [makeGroupedSession()] });
    const session = savedPlanToDraft(plan).weeks[0].days[0].session!;

    expect(session.groups).toHaveLength(2);
    const [circuit, bench] = session.groups;
    expect(groupSettingsOf(circuit)).toEqual(CIRCUIT);
    expect(groupSettingsOf(bench)).toEqual(STRAIGHT_SETS);
    expect(circuit.exercises.map((e) => e.name)).toEqual(["Back Squat", "Bent-over Row"]);
    expect(bench.exercises.map((e) => e.name)).toEqual(["Bench Press"]);

    // Draft identity is minted, never the row's id, and fresh on every build.
    expect(circuit.uid).toMatch(/^grp-/);
    expect(bench.uid).toMatch(/^grp-/);
    expect(circuit.uid).not.toBe(bench.uid);
    const again = savedPlanToDraft(plan).weeks[0].days[0].session!;
    expect(again.groups.map((g) => g.uid)).not.toContain(circuit.uid);
    expect(again.groups.map((g) => g.uid)).not.toContain(bench.uid);
  });

  it("round-trips savedPlan → draft → overwrite body keeping every group setting and exercise, in order", () => {
    const body = draftToOverwriteBody(
      savedPlanToDraft(makePlan({ sessions: [makeGroupedSession()] })),
    );

    expect(body.sessions[0].groups).toEqual(GROUPED_INPUT);
    expectNoPositionFields(body.sessions[0].groups);
    // The padded rest days carry no groups.
    expect(body.sessions.slice(1).every((s) => s.isRest && s.groups.length === 0)).toBe(true);

    const parsed = overwriteSavedPlanSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(body);
  });

  it("draftToInlinePlanBody emits the same groups and passes inlinePlanBodySchema", () => {
    const body = draftToInlinePlanBody(
      savedPlanToDraft(makePlan({ sessions: [makeGroupedSession()] })),
    );

    expect(body.sessions[0].groups).toEqual(GROUPED_INPUT);
    expectNoPositionFields(body.sessions[0].groups);

    const parsed = inlinePlanBodySchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(body);
  });

  it("sessionDraftToStandalonePayload emits the groups and passes createStandaloneSessionSchema", () => {
    const payload = sessionDraftToStandalonePayload(savedSessionToDraft(makeGroupedSession()));

    expect(payload.groups).toEqual(GROUPED_INPUT);
    expectNoPositionFields(payload.groups);

    const parsed = createStandaloneSessionSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(payload);
  });
});
