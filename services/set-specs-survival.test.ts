import { describe, it, expect, vi, beforeEach } from "vitest";

// set_specs / video_url survival matrix (Training Builder S2, Landmine #2).
//
// Every exercise clone/insert site must carry set_specs + video_url through, or
// per-set data is silently dropped on apply. This file exercises the INPUT sites
// (which re-project the compact columns via projectExerciseCompact) and the
// CLONE sites that copy an existing row.
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
import { insertSavedExercises } from "./coach-library-helpers";
import { saveSessionFromCalendar } from "./coach-library-calendar-service";
import { overwriteSavedPlan } from "./coach-saved-plan-service";

const mockFrom = vi.mocked(supabaseAdmin.from);

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

  it("INPUT choke — insertSavedExercises (save-to-library, AI + manual)", async () => {
    const ex = tableMock();
    mockFrom.mockImplementation(() => ex.base as never);

    await insertSavedExercises(
      "sess-1",
      [{ name: "Bench", sets: 99, setSpecs: SPECS as never, videoUrl: VIDEO, prescribedFields: [...FIELDS] }],
      new Map([["bench", "cat-1"]]),
    );

    expect((ex.inserts[0] as Record<string, unknown>[])[0]).toMatchObject({
      set_specs: SPECS, video_url: VIDEO, prescribed_fields: [...FIELDS], sets: 3, reps_min: 6, reps_max: 8,
    });
  });

  it("CLONE — saveSessionFromCalendar splats set_specs/video_url verbatim", async () => {
    const source = {
      id: "src", focus: null, estimated_duration_minutes: null, calorie_surplus_percentage: null, notes: null,
      training_exercises: [
        { is_active: true, exercise_id: "cat-1", name: "Bench", order_index: 0, sets: 3, reps_min: 6, reps_max: 8,
          reps_target: null, rpe_target: null, percentage_1rm: null, tempo: null, rest_seconds: null,
          superset_group: null, is_warmup: false, notes: null, set_specs: SPECS, video_url: VIDEO,
          prescribed_fields: [...FIELDS] },
      ],
    };
    const src = tableMock({ maybeSingle: { data: source, error: null } });
    const savedSess = tableMock({ single: { data: { id: "saved-1" }, error: null } });
    const savedEx = tableMock();
    mockFrom.mockImplementation((t: string) => {
      if (t === "training_sessions") return src.base as never;
      if (t === "coach_saved_sessions") return savedSess.base as never;
      return savedEx.base as never; // coach_saved_exercises
    });

    await saveSessionFromCalendar("coach-1", "src", "My Session");

    const row = (savedEx.inserts[0] as Record<string, unknown>[])[0];
    expect(row.set_specs).toEqual(SPECS);
    expect(row.video_url).toBe(VIDEO);
  });

  it("INPUT — overwriteSavedPlan (Save and Update Plan) + week_index on the session", async () => {
    const plans = tableMock({ single: { data: { id: "p" }, error: null } });
    const sessions = tableMock({ single: { data: { id: "s1" }, error: null } });
    const exercises = tableMock();
    mockFrom.mockImplementation((t: string) => {
      if (t === "coach_saved_plans") return plans.base as never;
      if (t === "coach_saved_sessions") return sessions.base as never;
      return exercises.base as never; // coach_saved_exercises
    });

    await overwriteSavedPlan("p", "coach-1", {
      name: "P",
      sessions: [
        {
          name: "Day1", focus: null, orderIndex: 0, weekIndex: 0, isRest: false,
          estimatedDurationMinutes: null, calorieSurplusPercentage: null, notes: null, sessionType: "training",
          exercises: [{ name: "Bench", exerciseId: "cat-1", orderIndex: 0, sets: 99, setSpecs: SPECS as never, videoUrl: VIDEO, prescribedFields: [...FIELDS] }],
        },
      ],
    });

    expect((sessions.inserts[0] as Record<string, unknown>).week_index).toBe(0);
    expectInputProjection((exercises.inserts[0] as Record<string, unknown>[])[0]);
  });

});
