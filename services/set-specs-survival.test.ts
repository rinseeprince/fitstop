import { describe, it, expect, vi, beforeEach } from "vitest";

// set_specs / video_url survival matrix (Training Builder S2, Landmine #2).
//
// Every exercise clone/insert site must carry set_specs + video_url through, or
// per-set data is silently dropped on apply. This file exercises the INPUT sites
// (which re-project the compact columns via projectExerciseCompact) and the
// CLONE sites that copy an existing row. Every site writes a session's groups
// first and then the exercises that sit in them (migration 178), so each case
// reads the exercise row from the second write and checks it names its group.
//
// The placement clone sites (pristine apply, inline apply, place-session) are
// covered in library-placement-service.test.ts; set_type-in-set_logs is covered
// in training-log-service.test.ts.
//
// Every site that can write set_specs is exercised below. If you add a new
// exercise insert/update path, add it here.

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("./exercise-catalog-service", () => ({
  resolveExercises: vi.fn().mockResolvedValue(new Map<string, string>()),
}));

import { supabaseAdmin } from "./supabase-admin";
import { insertSavedGroups, type SavedGroupWrite } from "./coach-library-helpers";
import { saveSessionFromCalendar } from "./coach-library-calendar-service";
import { overwriteSavedPlan } from "./coach-saved-plan-service";
import { STRAIGHT_SETS } from "@/utils/exercise-groups";

const mockFrom = vi.mocked(supabaseAdmin.from);

/** A lone exercise: a straight-sets group of one. */
const lone = (exercise: SavedGroupWrite["exercises"][number]): SavedGroupWrite => ({
  ...STRAIGHT_SETS,
  exercises: [exercise],
});

/** When a table mock's first insert ran, on the call order every mock shares. */
const firstInsertAt = (mock: { base: Record<string, unknown> }) =>
  (mock.base.insert as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];

// Authored per-set prescription: 1 warm-up + 2 working + 1 drop.
// compactFromSpecs → sets = 3 (non-warmup), reps range from the working set = 6..8.
const SPECS = [
  { set_number: 1, set_type: "warmup" },
  { set_number: 2, set_type: "working", reps_min: 6, reps_max: 8, load_type: "pct_1rm", load_value: 75 },
  { set_number: 3, set_type: "working" },
  { set_number: 4, set_type: "drop", drops: [{ weight: 100, reps: 8 }] },
];
const VIDEO = "https://demo/bench";
// Migration 149. Carried by the same sites as set_specs, and dropped just as
// silently — a clone that forgets it widens the client's grid back to all five
// columns and starts collecting data the coach chose not to prescribe.
const FIELDS = ["reps", "rest"] as const;

/** Chainable supabase query mock that records insert/update payloads. */
function tableMock(config: { single?: unknown; maybeSingle?: unknown } = {}) {
  const inserts: unknown[] = [];
  const updates: unknown[] = [];
  const base: Record<string, unknown> = {
    select: vi.fn(() => base),
    eq: vi.fn(() => base),
    order: vi.fn(() => base),
    limit: vi.fn(() => base),
    ilike: vi.fn(() => base),
    is: vi.fn(() => base),
    delete: vi.fn(() => base),
    insert: vi.fn((rows: unknown) => { inserts.push(rows); return base; }),
    update: vi.fn((patch: unknown) => { updates.push(patch); return base; }),
    single: vi.fn().mockResolvedValue(config.single ?? { data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue(config.maybeSingle ?? { data: null, error: null }),
  };
  Object.defineProperty(base, "then", {
    value: (resolve: (v: { data: null; error: null }) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve),
    configurable: true,
  });
  return { base, inserts, updates };
}

// Assert an INPUT-site row: set_specs verbatim + compact re-projected from specs.
function expectInputProjection(row: Record<string, unknown>) {
  expect(row.set_specs).toEqual(SPECS);
  expect(row.video_url).toBe(VIDEO);
  expect(row.prescribed_fields).toEqual([...FIELDS]);
  expect(row.sets).toBe(3);
  expect(row.reps_min).toBe(6);
  expect(row.reps_max).toBe(8);
}

describe("set_specs / video_url survival matrix", () => {
  beforeEach(() => vi.clearAllMocks());

  it("INPUT choke — insertSavedGroups (save-to-library, AI + manual)", async () => {
    const groups = tableMock();
    const ex = tableMock();
    mockFrom.mockImplementation((t: string) =>
      (t === "coach_saved_exercise_groups" ? groups.base : ex.base) as never,
    );

    await insertSavedGroups(
      "sess-1",
      [lone({ name: "Bench", sets: 99, setSpecs: SPECS as never, videoUrl: VIDEO, prescribedFields: [...FIELDS] })],
      new Map([["bench", "cat-1"]]),
    );

    expect(mockFrom.mock.calls.map(([t]) => t)).toEqual(["coach_saved_exercise_groups", "coach_saved_exercises"]);
    const [group] = groups.inserts[0] as Record<string, unknown>[];
    expect(group).toMatchObject({ saved_session_id: "sess-1", order_index: 0, format: "straight_sets" });
    expect((ex.inserts[0] as Record<string, unknown>[])[0]).toMatchObject({
      group_id: group.id, set_specs: SPECS, video_url: VIDEO, prescribed_fields: [...FIELDS], sets: 3, reps_min: 6, reps_max: 8,
    });
  });

  it("CLONE — saveSessionFromCalendar splats set_specs/video_url verbatim", async () => {
    const group = {
      id: "tg-1", session_id: "src", order_index: 0, format: "circuit", rounds: 3, time_cap_seconds: 600,
      interval_seconds: null, rest_between_exercises_seconds: 15, rest_between_rounds_seconds: 90, notes: "A",
      created_at: "2026-06-01T00:00:00Z", updated_at: "2026-06-01T00:00:00Z",
    };
    const source = {
      id: "src", focus: null, estimated_duration_minutes: null, calorie_surplus_percentage: null, notes: null,
      training_exercises: [
        { id: "te-1", session_id: "src", group_id: "tg-1", is_active: true, exercise_id: "cat-1", name: "Bench",
          order_index: 0, sets: 3, reps_min: 6, reps_max: 8,
          reps_target: null, rpe_target: null, percentage_1rm: null, tempo: null, rest_seconds: null,
          is_warmup: false, notes: null, set_specs: SPECS, video_url: VIDEO,
          prescribed_fields: [...FIELDS], exercise_group: group },
      ],
    };
    const src = tableMock({ maybeSingle: { data: source, error: null } });
    const savedSess = tableMock({ single: { data: { id: "saved-1" }, error: null } });
    const savedGroups = tableMock();
    const savedEx = tableMock();
    mockFrom.mockImplementation((t: string) => {
      if (t === "training_sessions") return src.base as never;
      if (t === "coach_saved_sessions") return savedSess.base as never;
      if (t === "coach_saved_exercise_groups") return savedGroups.base as never;
      return savedEx.base as never; // coach_saved_exercises
    });

    await saveSessionFromCalendar("coach-1", "src", "My Session");

    // The session, then its groups, then the exercises that name them.
    expect(firstInsertAt(savedSess)).toBeLessThan(firstInsertAt(savedGroups));
    expect(firstInsertAt(savedGroups)).toBeLessThan(firstInsertAt(savedEx));
    const [savedGroup] = savedGroups.inserts[0] as Record<string, unknown>[];
    expect(savedGroup).toMatchObject({
      saved_session_id: "saved-1", order_index: 0, format: "circuit", rounds: 3, time_cap_seconds: 600,
      interval_seconds: null, rest_between_exercises_seconds: 15, rest_between_rounds_seconds: 90, notes: "A",
    });
    const row = (savedEx.inserts[0] as Record<string, unknown>[])[0];
    expect(row.group_id).toBe(savedGroup.id);
    expect(row.set_specs).toEqual(SPECS);
    expect(row.video_url).toBe(VIDEO);
    expect(row.prescribed_fields).toEqual([...FIELDS]);
  });

  it("INPUT — overwriteSavedPlan (Save and Update Plan) + week_index on the session", async () => {
    const plans = tableMock({ single: { data: { id: "p" }, error: null } });
    const sessions = tableMock({ single: { data: { id: "s1" }, error: null } });
    const groups = tableMock();
    const exercises = tableMock();
    mockFrom.mockImplementation((t: string) => {
      if (t === "coach_saved_plans") return plans.base as never;
      if (t === "coach_saved_sessions") return sessions.base as never;
      if (t === "coach_saved_exercise_groups") return groups.base as never;
      return exercises.base as never; // coach_saved_exercises
    });

    await overwriteSavedPlan("p", "coach-1", {
      name: "P",
      sessions: [
        {
          name: "Day1", focus: null, orderIndex: 0, weekIndex: 0, isRest: false,
          estimatedDurationMinutes: null, calorieSurplusPercentage: null, notes: null, sessionType: "training",
          groups: [lone({ name: "Bench", exerciseId: "cat-1", sets: 99, setSpecs: SPECS as never, videoUrl: VIDEO, prescribedFields: [...FIELDS] })],
        },
      ],
    });

    // The sessions go in as one batch, each under the id minted for it.
    const [session] = sessions.inserts[0] as Record<string, unknown>[];
    expect(session).toMatchObject({ week_index: 0, order_index: 0, day_order: 0 });
    // The session, then its groups, then the exercises that name them.
    expect(firstInsertAt(sessions)).toBeLessThan(firstInsertAt(groups));
    expect(firstInsertAt(groups)).toBeLessThan(firstInsertAt(exercises));
    const [group] = groups.inserts[0] as Record<string, unknown>[];
    expect(group).toMatchObject({ saved_session_id: session.id, order_index: 0, format: "straight_sets" });
    const row = (exercises.inserts[0] as Record<string, unknown>[])[0];
    expect(row.group_id).toBe(group.id);
    expectInputProjection(row);
  });

});
