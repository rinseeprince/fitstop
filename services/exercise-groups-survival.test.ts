import { beforeEach, describe, expect, it, vi } from "vitest";

// Groups survival matrix (migration 178). Every path that saves or copies a
// session's exercises must carry its groups exactly — each group's settings
// and place, and each exercise's place in its group — and every exercise's
// prescribed_fields and set_specs with them. A field one path forgets vanishes
// without an error, so each path is proved here against the rows it writes.
//
// The session every path is handed: a circuit of two exercises (every setting
// set), then a lone exercise. Edit plan's payload is proved in
// plan-edit-service.test.ts and its database function against DEV; the log's
// prescription snapshot in training-log-service.test.ts.

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("./exercise-catalog-service", () => ({
  resolveExercises: vi.fn().mockResolvedValue(new Map<string, string>()),
}));
vi.mock("./training-service", () => ({
  createTrainingPlanAtomic: vi.fn().mockResolvedValue("plan-new"),
}));
vi.mock("./program-event-walk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./program-event-walk")>()),
  resolvePlacementWindowEnd: vi.fn().mockResolvedValue("2026-10-11"),
  generateProgramEvents: vi.fn().mockResolvedValue(1),
}));
vi.mock("./training-event-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./training-event-service")>()),
  cancelFutureEventsForPlans: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./training-event-occupancy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./training-event-occupancy")>()),
  assertDateFree: vi.fn().mockResolvedValue(undefined),
  assertSessionUnlogged: vi.fn().mockResolvedValue(undefined),
}));

import { supabaseAdmin } from "./supabase-admin";
import {
  createSavedPlanManual,
  duplicateSavedPlan,
  overwriteSavedPlan,
  promoteDraftToSaved,
} from "./coach-saved-plan-service";
import {
  createStandaloneSession,
  overwriteStandaloneSession,
} from "./coach-standalone-session-service";
import { saveSessionFromCalendar } from "./coach-library-calendar-service";
import {
  placeInlineEditedPlanOnCalendar,
  placePlanOnCalendar,
  placeSessionOnCalendar,
} from "./library-placement-service";
import { cloneSessionForEvent } from "./training-session-service";
import { replaceSessionFull } from "./training-session-replace-service";
import type { InlinePlanBody, SavedExerciseGroupInput } from "@/lib/validations/training";

const mockFrom = vi.mocked(supabaseAdmin.from);

// --- a recording database -----------------------------------------------------

type Call = {
  table: string;
  op: "select" | "insert" | "update" | "delete" | "upsert";
  columns?: string;
  payload?: unknown;
  filters: unknown[][];
};
type Result = { data: unknown; error: { message: string; code?: string } | null };
type Row = Record<string, unknown>;

const ok = (data: unknown = null): Result => ({ data, error: null });

function recordingDb(respond: (call: Call) => Result) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, op: "select", filters: [] };
    const settle = () => {
      calls.push(call);
      return Promise.resolve(respond(call));
    };
    const builder: Record<string, unknown> = {};
    const chain =
      (name: string) =>
      (...args: unknown[]) => {
        if (name === "select") call.columns = args[0] as string;
        else if (name === "insert" || name === "update" || name === "delete" || name === "upsert") {
          call.op = name;
          call.payload = args[0];
        } else call.filters.push([name, ...args]);
        return builder;
      };
    for (const name of [
      "select", "insert", "update", "delete", "upsert", "eq", "neq", "gt", "gte", "lt", "lte",
      "in", "is", "or", "not", "ilike", "order", "limit", "range",
    ]) {
      builder[name] = chain(name);
    }
    builder.single = settle;
    builder.maybeSingle = settle;
    Object.defineProperty(builder, "then", {
      value: (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
        settle().then(resolve, reject),
    });
    return builder;
  };
  const inserted = (table: string): Row[] =>
    calls
      .filter((c) => c.table === table && c.op === "insert")
      .flatMap((c) => (Array.isArray(c.payload) ? (c.payload as Row[]) : [c.payload as Row]));
  return { from, calls, inserted };
}

function installDb(respond: (call: Call) => Result) {
  const db = recordingDb(respond);
  mockFrom.mockImplementation(db.from as never);
  return db;
}

// --- the session every path is handed ----------------------------------------

const ROW_SPECS = [
  { set_number: 1, set_type: "working", reps_min: 10, reps_max: 12 },
  { set_number: 2, set_type: "working", reps_min: 8, reps_max: 10 },
];

const CIRCUIT_SETTINGS = {
  format: "circuit",
  rounds: 3,
  timeCapSeconds: 600,
  intervalSeconds: 60,
  restBetweenExercisesSeconds: 15,
  restBetweenRoundsSeconds: 90,
  notes: "A",
} as const;

const STRAIGHT = {
  format: "straight_sets",
  rounds: null,
  timeCapSeconds: null,
  intervalSeconds: null,
  restBetweenExercisesSeconds: null,
  restBetweenRoundsSeconds: null,
  notes: null,
} as const;

/** The groups as a write path receives them (zod output shape). */
const INPUT_GROUPS: SavedExerciseGroupInput[] = [
  {
    ...CIRCUIT_SETTINGS,
    exercises: [
      { name: "Row", exerciseId: "cat-row", sets: 2, setSpecs: ROW_SPECS as never, prescribedFields: ["reps", "rest"] },
      { name: "Burpee", exerciseId: "cat-burpee", sets: 3, repsMin: 10, repsMax: 10, prescribedFields: null },
    ],
  },
  {
    ...STRAIGHT,
    exercises: [{ name: "Squat", exerciseId: "cat-squat", sets: 5, repsMin: 5, repsMax: 5, prescribedFields: ["load", "reps"] }],
  },
];

/** What every path must have written, group by group. */
const EXPECTED_SHAPE = [
  {
    order_index: 0,
    format: "circuit",
    rounds: 3,
    time_cap_seconds: 600,
    interval_seconds: 60,
    rest_between_exercises_seconds: 15,
    rest_between_rounds_seconds: 90,
    notes: "A",
    exercises: [
      { order_index: 0, name: "Row", prescribed_fields: ["reps", "rest"], set_specs: ROW_SPECS },
      { order_index: 1, name: "Burpee", prescribed_fields: null, set_specs: null },
    ],
  },
  {
    order_index: 1,
    format: "straight_sets",
    rounds: null,
    time_cap_seconds: null,
    interval_seconds: null,
    rest_between_exercises_seconds: null,
    rest_between_rounds_seconds: null,
    notes: null,
    exercises: [{ order_index: 0, name: "Squat", prescribed_fields: ["load", "reps"], set_specs: null }],
  },
];

/**
 * Rebuild the groups a path wrote for one session from its group and exercise
 * rows — every exercise must name a group written for the same session.
 */
function writtenShape(
  groupRows: Row[],
  exerciseRows: Row[],
  sessionKey: "session_id" | "saved_session_id",
  sessionId: string,
) {
  const groups = groupRows.filter((g) => g[sessionKey] === sessionId);
  const exercises = exerciseRows.filter((e) => e[sessionKey] === sessionId);
  for (const e of exercises) {
    expect(groups.some((g) => g.id === e.group_id)).toBe(true);
  }
  expect(new Set(groups.map((g) => g.id)).size).toBe(groups.length);
  return [...groups]
    .sort((a, b) => Number(a.order_index) - Number(b.order_index))
    .map((g) => ({
      order_index: g.order_index,
      format: g.format,
      rounds: g.rounds,
      time_cap_seconds: g.time_cap_seconds,
      interval_seconds: g.interval_seconds,
      rest_between_exercises_seconds: g.rest_between_exercises_seconds,
      rest_between_rounds_seconds: g.rest_between_rounds_seconds,
      notes: g.notes,
      exercises: exercises
        .filter((e) => e.group_id === g.id)
        .sort((a, b) => Number(a.order_index) - Number(b.order_index))
        .map((e) => ({
          order_index: e.order_index,
          name: e.name,
          prescribed_fields: e.prescribed_fields,
          set_specs: e.set_specs,
        })),
    }));
}

// --- the same session as stored rows ------------------------------------------

const groupColumns = (settings: typeof CIRCUIT_SETTINGS | typeof STRAIGHT) => ({
  format: settings.format,
  rounds: settings.rounds,
  time_cap_seconds: settings.timeCapSeconds,
  interval_seconds: settings.intervalSeconds,
  rest_between_exercises_seconds: settings.restBetweenExercisesSeconds,
  rest_between_rounds_seconds: settings.restBetweenRoundsSeconds,
  notes: settings.notes,
});

const exerciseColumns = {
  reps_target: null,
  rpe_target: null,
  percentage_1rm: null,
  tempo: null,
  rest_seconds: null,
  notes: null,
  is_warmup: false,
  video_url: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

/** A library session's groups, as the embed returns them (out of order on purpose). */
function libraryGroupTree(sessionId: string) {
  return [
    {
      id: "lg-straight",
      saved_session_id: sessionId,
      order_index: 1,
      ...groupColumns(STRAIGHT),
      coach_saved_exercises: [
        { id: "le-squat", saved_session_id: sessionId, group_id: "lg-straight", exercise_id: "cat-squat", name: "Squat", order_index: 0, sets: 5, reps_min: 5, reps_max: 5, set_specs: null, prescribed_fields: ["load", "reps"], ...exerciseColumns },
      ],
    },
    {
      id: "lg-circuit",
      saved_session_id: sessionId,
      order_index: 0,
      ...groupColumns(CIRCUIT_SETTINGS),
      coach_saved_exercises: [
        { id: "le-burpee", saved_session_id: sessionId, group_id: "lg-circuit", exercise_id: "cat-burpee", name: "Burpee", order_index: 1, sets: 3, reps_min: 10, reps_max: 10, set_specs: null, prescribed_fields: null, ...exerciseColumns },
        { id: "le-row", saved_session_id: sessionId, group_id: "lg-circuit", exercise_id: "cat-row", name: "Row", order_index: 0, sets: 2, reps_min: 8, reps_max: 12, set_specs: ROW_SPECS, prescribed_fields: ["reps", "rest"], ...exerciseColumns },
      ],
    },
  ];
}

function librarySessionRow(id: string, overrides: Row = {}) {
  return {
    id,
    coach_id: "coach-1",
    saved_plan_id: "plan-1",
    name: "Hybrid",
    focus: null,
    order_index: 0,
    week_index: 0,
    is_rest: false,
    estimated_duration_minutes: 45,
    calorie_surplus_percentage: null,
    notes: null,
    session_type: "training",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    coach_saved_exercise_groups: libraryGroupTree(id),
    ...overrides,
  };
}

function libraryRestRow(id: string, orderIndex: number) {
  return librarySessionRow(id, {
    name: "Rest",
    is_rest: true,
    order_index: orderIndex,
    coach_saved_exercise_groups: [],
  });
}

/** A client session's live exercises, each read with its group (EXERCISE_WITH_GROUP_COLUMNS). */
function clientExerciseRows(sessionId: string) {
  const circuit = { id: "cg-circuit", session_id: sessionId, order_index: 0, ...groupColumns(CIRCUIT_SETTINGS), created_at: "x", updated_at: "x" };
  const straight = { id: "cg-straight", session_id: sessionId, order_index: 1, ...groupColumns(STRAIGHT), created_at: "x", updated_at: "x" };
  return [
    { id: "ce-squat", session_id: sessionId, group_id: "cg-straight", exercise_id: "cat-squat", name: "Squat", order_index: 0, sets: 5, reps_min: 5, reps_max: 5, set_specs: null, prescribed_fields: ["load", "reps"], is_active: true, ...exerciseColumns, exercise_group: straight },
    { id: "ce-burpee", session_id: sessionId, group_id: "cg-circuit", exercise_id: "cat-burpee", name: "Burpee", order_index: 1, sets: 3, reps_min: 10, reps_max: 10, set_specs: null, prescribed_fields: null, is_active: true, ...exerciseColumns, exercise_group: circuit },
    { id: "ce-row", session_id: sessionId, group_id: "cg-circuit", exercise_id: "cat-row", name: "Row", order_index: 0, sets: 2, reps_min: 8, reps_max: 12, set_specs: ROW_SPECS, prescribed_fields: ["reps", "rest"], is_active: true, ...exerciseColumns, exercise_group: circuit },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// Library writes
// =============================================================================

describe("library writes carry groups", () => {
  it("the library save (overwriteSavedPlan) writes each session's groups and exercises in order", async () => {
    let sessionCount = 0;
    const db = installDb((call) => {
      if (call.table === "coach_saved_plans" && call.op === "select") return ok({ id: "plan-1" });
      if (call.table === "coach_saved_sessions" && call.op === "select") return ok([{ id: "old-1" }]);
      if (call.table === "coach_saved_sessions" && call.op === "insert") return ok({ id: `new-${++sessionCount}` });
      return ok();
    });

    await overwriteSavedPlan("plan-1", "coach-1", {
      name: "P",
      sessions: [
        { name: "Hybrid", orderIndex: 0, weekIndex: 0, isRest: false, groups: INPUT_GROUPS },
        { name: "Rest", orderIndex: 1, weekIndex: 0, isRest: true, groups: [] },
      ],
    });

    expect(
      writtenShape(db.inserted("coach_saved_exercise_groups"), db.inserted("coach_saved_exercises"), "saved_session_id", "new-1"),
    ).toEqual(EXPECTED_SHAPE);
    expect(db.inserted("coach_saved_exercise_groups").filter((g) => g.saved_session_id === "new-2")).toEqual([]);
    // The groups land before the exercises that name them.
    const order = db.calls.filter((c) => c.op === "insert").map((c) => c.table);
    expect(order.indexOf("coach_saved_exercise_groups")).toBeLessThan(order.indexOf("coach_saved_exercises"));
  });

  it("creating a program (createSavedPlanManual) writes its sessions' groups", async () => {
    let sessionCount = 0;
    const db = installDb((call) => {
      if (call.table === "coach_saved_plans" && call.op === "insert") return ok({ id: "plan-new" });
      if (call.table === "coach_saved_sessions" && call.op === "insert") return ok({ id: `s-${++sessionCount}` });
      return ok();
    });

    await createSavedPlanManual("coach-1", "P", null, [
      { name: "Hybrid", isRest: false, groups: INPUT_GROUPS },
      { name: "Rest", isRest: true, groups: [] },
    ]);

    expect(
      writtenShape(db.inserted("coach_saved_exercise_groups"), db.inserted("coach_saved_exercises"), "saved_session_id", "s-1"),
    ).toEqual(EXPECTED_SHAPE);
  });

  it("duplicating a program copies every group and exercise verbatim under fresh group ids", async () => {
    let sessionCount = 0;
    const db = installDb((call) => {
      if (call.table === "coach_saved_plans" && call.op === "select" && call.columns?.includes("coach_saved_sessions")) {
        return ok({
          id: "plan-1",
          coach_id: "coach-1",
          name: "P",
          status: "saved",
          coach_saved_sessions: [librarySessionRow("src-1"), libraryRestRow("src-rest", 1)],
        });
      }
      if (call.table === "coach_saved_plans" && call.op === "select") return ok([{ name: "P" }]);
      if (call.table === "coach_saved_plans" && call.op === "insert") return ok({ id: "plan-copy" });
      if (call.table === "coach_saved_sessions" && call.op === "insert") return ok({ id: `copy-${++sessionCount}` });
      return ok();
    });

    await duplicateSavedPlan("plan-1", "coach-1");

    const groups = db.inserted("coach_saved_exercise_groups");
    expect(writtenShape(groups, db.inserted("coach_saved_exercises"), "saved_session_id", "copy-1")).toEqual(EXPECTED_SHAPE);
    expect(groups.map((g) => g.id)).not.toContain("lg-circuit");
    const exercises = db.inserted("coach_saved_exercises");
    expect(exercises.find((e) => e.name === "Row")).toMatchObject({ exercise_id: "cat-row", sets: 2, reps_min: 8, reps_max: 12 });
  });

  it("promoting a draft with its sessions saved individually copies their groups", async () => {
    const db = installDb((call) => {
      if (call.table === "coach_saved_plans" && call.op === "select" && call.columns === "id, name, coach_id, status") {
        return ok({ id: "plan-1", name: "P", coach_id: "coach-1", status: "draft" });
      }
      if (call.table === "coach_saved_plans" && call.op === "select") return ok(null);
      if (call.table === "coach_saved_sessions" && call.op === "select" && call.columns?.includes("coach_saved_exercise_groups")) {
        return ok([librarySessionRow("draft-s1")]);
      }
      if (call.table === "coach_saved_sessions" && call.op === "select") return ok(null);
      if (call.table === "coach_saved_sessions" && call.op === "insert") return ok({ id: "standalone-1" });
      return ok();
    });

    await promoteDraftToSaved("plan-1", "coach-1", { saveSessionsIndividually: true });

    expect(
      writtenShape(db.inserted("coach_saved_exercise_groups"), db.inserted("coach_saved_exercises"), "saved_session_id", "standalone-1"),
    ).toEqual(EXPECTED_SHAPE);
  });

  it("creating a standalone session writes its groups", async () => {
    const db = installDb((call) => {
      if (call.table === "exercises") return ok([{ id: "cat-row" }, { id: "cat-burpee" }, { id: "cat-squat" }]);
      if (call.table === "coach_saved_sessions" && call.op === "insert") return ok({ id: "standalone-new" });
      return ok();
    });

    await createStandaloneSession("coach-1", { name: "Hybrid", groups: INPUT_GROUPS });

    expect(
      writtenShape(db.inserted("coach_saved_exercise_groups"), db.inserted("coach_saved_exercises"), "saved_session_id", "standalone-new"),
    ).toEqual(EXPECTED_SHAPE);
  });

  it("overwriting a standalone session replaces its groups: the old groups are deleted, the new ones written", async () => {
    const db = installDb((call) => {
      if (call.table === "coach_saved_sessions" && call.op === "select") {
        return ok(librarySessionRow("standalone-1", { saved_plan_id: null, coach_saved_exercise_groups: [] }));
      }
      if (call.table === "exercises") return ok([{ id: "cat-row" }, { id: "cat-burpee" }, { id: "cat-squat" }]);
      return ok();
    });

    await overwriteStandaloneSession("standalone-1", "coach-1", { name: "Hybrid", groups: INPUT_GROUPS });

    const groupDelete = db.calls.find((c) => c.table === "coach_saved_exercise_groups" && c.op === "delete");
    expect(groupDelete?.filters).toContainEqual(["eq", "saved_session_id", "standalone-1"]);
    expect(
      writtenShape(db.inserted("coach_saved_exercise_groups"), db.inserted("coach_saved_exercises"), "saved_session_id", "standalone-1"),
    ).toEqual(EXPECTED_SHAPE);
  });

  it("a standalone overwrite whose exercises fail to write restores the session's groups as they were", async () => {
    let exerciseInserts = 0;
    const db = installDb((call) => {
      if (call.table === "coach_saved_sessions" && call.op === "select") {
        return ok(librarySessionRow("standalone-1", { saved_plan_id: null }));
      }
      if (call.table === "exercises") return ok([]);
      if (call.table === "coach_saved_exercises" && call.op === "insert" && ++exerciseInserts === 1) {
        return { data: null, error: { message: "boom" } };
      }
      return ok();
    });

    await expect(
      overwriteStandaloneSession("standalone-1", "coach-1", {
        name: "Hybrid",
        groups: [{ format: "straight_sets", exercises: [{ name: "Other", sets: 1 }] }],
      }),
    ).rejects.toThrow("boom");

    const groupInserts = db.calls.filter((c) => c.table === "coach_saved_exercise_groups" && c.op === "insert");
    const exerciseInsertCalls = db.calls.filter((c) => c.table === "coach_saved_exercises" && c.op === "insert");
    expect(groupInserts).toHaveLength(2);
    expect(exerciseInsertCalls).toHaveLength(2);
    // Cleared twice: once before the write, once before the restore.
    expect(db.calls.filter((c) => c.table === "coach_saved_exercise_groups" && c.op === "delete")).toHaveLength(2);
    const restored = writtenShape(
      groupInserts[1].payload as Row[],
      exerciseInsertCalls[1].payload as Row[],
      "saved_session_id",
      "standalone-1",
    );
    expect(restored).toEqual(EXPECTED_SHAPE);
  });

  it("saving a client's session to the library copies its live groups, verbatim", async () => {
    const retired = {
      ...clientExerciseRows("client-s1")[0],
      id: "ce-retired",
      name: "Retired",
      is_active: false,
      group_id: "cg-retired",
      exercise_group: { ...clientExerciseRows("client-s1")[0].exercise_group, id: "cg-retired", order_index: 0 },
    };
    const db = installDb((call) => {
      if (call.table === "training_sessions") {
        return ok({
          id: "client-s1",
          focus: null,
          estimated_duration_minutes: 45,
          calorie_surplus_percentage: null,
          notes: null,
          training_exercises: [retired, ...clientExerciseRows("client-s1")],
        });
      }
      if (call.table === "coach_saved_sessions" && call.op === "insert") return ok({ id: "saved-from-calendar" });
      return ok();
    });

    await saveSessionFromCalendar("coach-1", "client-s1", "Hybrid");

    expect(
      writtenShape(db.inserted("coach_saved_exercise_groups"), db.inserted("coach_saved_exercises"), "saved_session_id", "saved-from-calendar"),
    ).toEqual(EXPECTED_SHAPE);
    expect(db.inserted("coach_saved_exercises").map((e) => e.name)).not.toContain("Retired");
  });
});

// =============================================================================
// Placement and the calendar
// =============================================================================

function placementDb(extra: (call: Call) => Result | null = () => null) {
  return installDb((call) => {
    const answered = extra(call);
    if (answered) return answered;
    if (call.table === "training_events" && call.op === "select") return ok([]);
    if (call.table === "training_plans" && call.op === "select") return ok([]);
    if (call.table === "training_sessions" && call.op === "insert") {
      return ok(
        (call.payload as Row[]).map((row) => ({
          id: `ts-${String(row.week_index)}-${String(row.order_index)}`,
          week_index: row.week_index,
          order_index: row.order_index,
        })),
      );
    }
    return ok();
  });
}

const ONE_WEEK = [
  librarySessionRow("lib-day-0"),
  ...Array.from({ length: 6 }, (_, i) => libraryRestRow(`lib-rest-${i + 1}`, i + 1)),
];

describe("placement carries groups onto the client's calendar", () => {
  it("placing a library program clones every group and exercise into the client's session", async () => {
    const db = placementDb((call) =>
      call.table === "coach_saved_plans"
        ? ok({ id: "plan-1", coach_id: "coach-1", name: "P", status: "saved", split_type: null, frequency_per_week: 1, default_surplus_percentage: null, source: "manual", coach_prompt: null, program_duration_weeks: 1, coach_saved_sessions: ONE_WEEK })
        : null,
    );

    await placePlanOnCalendar({ savedPlanId: "plan-1", coachId: "coach-1", clientId: "client-1", startDate: "2026-10-05" });

    expect(
      writtenShape(db.inserted("training_exercise_groups"), db.inserted("training_exercises"), "session_id", "ts-0-0"),
    ).toEqual(EXPECTED_SHAPE);
    expect(db.inserted("training_exercises").every((e) => e.is_active === true)).toBe(true);
  });

  it("placing an edited client draft clones the groups the coach sent", async () => {
    const db = placementDb((call) =>
      call.table === "exercises" ? ok([{ id: "cat-row" }, { id: "cat-burpee" }, { id: "cat-squat" }]) : null,
    );
    const plan: InlinePlanBody = {
      name: "P",
      sessions: [
        { name: "Hybrid", orderIndex: 0, weekIndex: 0, isRest: false, groups: INPUT_GROUPS },
        ...Array.from({ length: 6 }, (_, i) => ({ name: "Rest", orderIndex: i + 1, weekIndex: 0, isRest: true, groups: [] })),
      ],
    };

    await placeInlineEditedPlanOnCalendar({ plan, coachId: "coach-1", clientId: "client-1", startDate: "2026-10-05" });

    expect(
      writtenShape(db.inserted("training_exercise_groups"), db.inserted("training_exercises"), "session_id", "ts-0-0"),
    ).toEqual(EXPECTED_SHAPE);
    expect(db.inserted("training_exercises").find((e) => e.name === "Squat")).toMatchObject({ exercise_id: "cat-squat" });
  });

  it("dropping a library session onto the calendar clones its groups", async () => {
    const db = installDb((call) => {
      if (call.table === "coach_saved_sessions") return ok(librarySessionRow("lib-s1", { saved_plan_id: null }));
      if (call.table === "training_sessions" && call.op === "select") return ok(null);
      if (call.table === "training_sessions" && call.op === "insert") return ok({ id: "ts-dropped" });
      if (call.table === "training_events" && call.op === "insert") return ok({ id: "ev-dropped" });
      return ok();
    });

    await placeSessionOnCalendar({ savedSessionId: "lib-s1", coachId: "coach-1", clientId: "client-1", planId: "plan-1", targetDate: "2026-10-07" });

    expect(
      writtenShape(db.inserted("training_exercise_groups"), db.inserted("training_exercises"), "session_id", "ts-dropped"),
    ).toEqual(EXPECTED_SHAPE);
  });
});

// =============================================================================
// The placed-session tray
// =============================================================================

describe("the placed-session tray carries groups", () => {
  function trayDb(extra: (call: Call) => Result | null = () => null) {
    return installDb((call) => {
      const answered = extra(call);
      if (answered) return answered;
      if (call.table === "training_events" && call.op === "select") return ok({ id: "ev-1" });
      if (call.table === "training_sessions" && call.op === "select") {
        return ok({ id: "client-s1", plan_id: "plan-1", name: "Hybrid", focus: null, order_index: 0, week_index: 0, is_rest: false, notes: null, estimated_duration_minutes: 45, estimated_calories: null, calories_calculated_at: null, calorie_surplus_percentage: null });
      }
      if (call.table === "training_sessions" && call.op === "insert") return ok({ id: "clone-1" });
      return ok();
    });
  }

  it("editing just this day with changes clones the session with the groups the coach sent", async () => {
    const db = trayDb();

    await cloneSessionForEvent("client-s1", "ev-1", "client-1", "coach-1", INPUT_GROUPS);

    expect(
      writtenShape(db.inserted("training_exercise_groups"), db.inserted("training_exercises"), "session_id", "clone-1"),
    ).toEqual(EXPECTED_SHAPE);
  });

  it("cloning a session for one day copies its live groups as they are", async () => {
    const db = trayDb((call) =>
      call.table === "training_exercises" && call.op === "select" ? ok(clientExerciseRows("client-s1")) : null,
    );

    await cloneSessionForEvent("client-s1", "ev-1", "client-1", "coach-1");

    expect(
      writtenShape(db.inserted("training_exercise_groups"), db.inserted("training_exercises"), "session_id", "clone-1"),
    ).toEqual(EXPECTED_SHAPE);
    const read = db.calls.find((c) => c.table === "training_exercises" && c.op === "select");
    expect(read?.columns).toContain("training_exercises_group_fkey");
    expect(read?.filters).toContainEqual(["eq", "is_active", true]);
  });

  it("saving every occurrence replaces the exercises with the new groups and retires the old rows", async () => {
    const db = installDb((call) => {
      if (call.table === "training_sessions" && call.op === "select" && call.columns?.startsWith("*")) {
        return ok({ id: "client-s1", plan_id: "plan-1", name: "Hybrid", focus: null, is_rest: false, calorie_surplus_percentage: null });
      }
      if (call.table === "training_sessions" && call.op === "select") return ok({ id: "client-s1" });
      if (call.table === "training_exercises" && call.op === "select" && call.columns === "id") {
        return ok([{ id: "old-ex-1" }]);
      }
      if (call.table === "training_exercises" && call.op === "select") return ok(clientExerciseRows("client-s1"));
      if (call.table === "training_sessions" && call.op === "update") {
        return ok({ id: "client-s1", plan_id: "plan-1", name: "Hybrid", order_index: 0, created_at: "x", updated_at: "x" });
      }
      return ok();
    });

    const result = await replaceSessionFull({
      sessionId: "client-s1",
      planId: "plan-1",
      clientId: "client-1",
      coachId: "coach-1",
      fromDate: "2026-10-05",
      input: { name: "Hybrid", groups: INPUT_GROUPS },
    });

    expect(
      writtenShape(db.inserted("training_exercise_groups"), db.inserted("training_exercises"), "session_id", "client-s1"),
    ).toEqual(EXPECTED_SHAPE);
    const retire = db.calls.find((c) => c.table === "training_exercises" && c.op === "update");
    expect(retire?.payload).toMatchObject({ is_active: false });
    expect(retire?.filters).toContainEqual(["in", "id", ["old-ex-1"]]);
    // The saved session comes back in its groups.
    expect(result.session.groups.map((g) => [g.format, g.exercises.map((e) => e.name)])).toEqual([
      ["circuit", ["Row", "Burpee"]],
      ["straight_sets", ["Squat"]],
    ]);
    expect(result.session.groups[0]).toMatchObject(CIRCUIT_SETTINGS);
  });
});
