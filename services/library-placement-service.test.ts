import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SavedPlan, SavedSession, SavedExercise, SavedExerciseGroup } from "@/types/training";

// Mock supabase-admin before importing the service
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

// Mock dependent services
vi.mock("./coach-saved-plan-service", () => ({
  getSavedPlanById: vi.fn(),
}));

vi.mock("./training-service", () => ({
  createTrainingPlanAtomic: vi.fn(),
}));

vi.mock("./training-event-service", () => ({
  getNextPlanStartCap: vi.fn(),
  cancelFutureEventsForPlans: vi.fn().mockResolvedValue(undefined),
}));

// The block covering the start date is now the placement window's length knob.
// Defaulted to "no block" so every test written before that keeps the authored
// length it asserts against.
vi.mock("./client-blocks-service", () => ({
  getBlockBoundForDate: vi.fn(),
}));

import { supabaseAdmin } from "./supabase-admin";
import { getSavedPlanById } from "./coach-saved-plan-service";
import { createTrainingPlanAtomic } from "./training-service";
import { getNextPlanStartCap, cancelFutureEventsForPlans } from "./training-event-service";
import { getBlockBoundForDate } from "./client-blocks-service";
import {
  placePlanOnCalendar,
  placeSessionOnCalendar,
  placeInlineEditedPlanOnCalendar,
  PlacementSupersedeError,
} from "./library-placement-service";
import { deriveFrequencyPerWeek } from "./coach-library-helpers";
import { BLOCKS_UNREADABLE } from "@/lib/constants";
import type { InlinePlanBody } from "@/lib/validations/training";
import { SAVED_SESSION_GROUPS_EMBED } from "@/lib/coach-mappers";
import { STRAIGHT_SETS } from "@/utils/exercise-groups";

const mockFrom = vi.mocked(supabaseAdmin.from);
const mockGetSavedPlanById = vi.mocked(getSavedPlanById);
const mockCreateAtomic = vi.mocked(createTrainingPlanAtomic);
const mockGetNextPlanStartCap = vi.mocked(getNextPlanStartCap);
const mockGetBlockBound = vi.mocked(getBlockBoundForDate);

// Inline query mock helper
function createMockQuery<T = unknown>(result: { data: T | null; error: { message: string } | null }) {
  const mockQuery = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: vi.fn(),
  };

  Object.defineProperty(mockQuery, "then", {
    value: (resolve: (value: typeof result) => void) =>
      Promise.resolve(result).then(resolve),
  });

  return mockQuery;
}

// A training_sessions insert mock. The clone is BATCHED, so `insert` takes an
// ARRAY of slot rows and the awaited result echoes each row's grid coordinate
// beside a distinct cloned id — the service keys exercises on that coordinate
// rather than on the returned row order.
function makeSessionInsertQuery(ids: string[]) {
  let i = 0;
  let rows: Array<Record<string, unknown>> = [];
  const query: Record<string, unknown> = {
    ...createMockQuery({ data: null, error: null }),
    insert: vi.fn((chunk: Array<Record<string, unknown>>) => {
      rows = chunk;
      return query;
    }),
    select: vi.fn(() => query),
  };
  Object.defineProperty(query, "then", {
    value: (resolve: (v: unknown) => void) =>
      Promise.resolve({
        data: rows.map((row) => ({
          id: ids[i++] ?? `ts-${i}`,
          week_index: row.week_index,
          order_index: row.order_index,
        })),
        error: null,
      }).then(resolve),
  });
  return query as ReturnType<typeof createMockQuery> & { insert: ReturnType<typeof vi.fn> };
}

/** The slot rows a batched session insert was handed, flattened in order. */
function insertedSlots(q: { insert: ReturnType<typeof vi.fn> }) {
  return q.insert.mock.calls.flatMap((c) => c[0] as Array<Record<string, never>>);
}

// --- Test data factories ---

/** Each exercise alone in a straight-sets group, the groups in the exercises' order. */
function loneGroups(...exercises: SavedExercise[]): SavedExerciseGroup[] {
  return exercises.map((exercise, orderIndex) => ({
    id: `grp-${exercise.id}`,
    savedSessionId: exercise.savedSessionId,
    orderIndex,
    ...STRAIGHT_SETS,
    exercises: [{ ...exercise, groupId: `grp-${exercise.id}`, orderIndex: 0 }],
  }));
}

function makeExercise(overrides?: Partial<SavedExercise>): SavedExercise {
  return {
    id: "ex-1",
    savedSessionId: "ss-1",
    groupId: "grp-ex-1",
    exerciseId: "catalog-1",
    name: "Bench Press",
    orderIndex: 0,
    sets: 4,
    repsMin: 8,
    repsMax: 12,
    repsTarget: null,
    rpeTarget: 8,
    percentage1rm: null,
    tempo: null,
    restSeconds: 90,
    isWarmup: false,
    notes: null,
    setSpecs: null,
    videoUrl: null,
    prescribedFields: null,
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

function makeSession(overrides?: Partial<SavedSession>): SavedSession {
  return {
    id: "ss-1",
    coachId: "coach-1",
    savedPlanId: "sp-1",
    name: "Push",
    focus: "chest",
    orderIndex: 0,
    weekIndex: 0,
    isRest: false,
    estimatedDurationMinutes: 60,
    calorieSurplusPercentage: 15,
    notes: null,
    sessionType: "training",
    groups: loneGroups(makeExercise()),
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

function makeSavedPlan(overrides?: Partial<SavedPlan>): SavedPlan {
  return {
    id: "sp-1",
    coachId: "coach-1",
    name: "PPL Program",
    description: null,
    splitType: "push_pull_legs",
    frequencyPerWeek: 3,
    status: "saved",
    defaultSurplusPercentage: 10,
    source: "ai",
    coachPrompt: null,
    programDurationWeeks: null,
    sessions: [
      makeSession({ id: "ss-1", name: "Push", orderIndex: 0, focus: "chest" }),
      makeSession({ id: "ss-2", name: "Pull", orderIndex: 1, focus: "back" }),
      makeSession({ id: "ss-3", name: "Legs", orderIndex: 2, focus: "legs" }),
      makeSession({ id: "ss-rest", name: "Rest", orderIndex: 3, isRest: true, groups: [] }),
    ],
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

describe("library-placement-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: this is the last plan, so no next-plan cap shortens the window.
    mockGetNextPlanStartCap.mockResolvedValue(null);
    // Default: no block covers the start date, so the window is the authored
    // program's own length — the behaviour every test below was written against.
    mockGetBlockBound.mockResolvedValue(null);
  });

  // =========================================================================
  // placePlanOnCalendar
  // =========================================================================

  describe("placePlanOnCalendar", () => {
    it("rejects draft plans", async () => {
      mockGetSavedPlanById.mockResolvedValue(makeSavedPlan({ status: "draft" }));
      await expect(
        placePlanOnCalendar({ savedPlanId: "sp-1", coachId: "coach-1", clientId: "client-1", startDate: "2026-04-15" }),
      ).rejects.toThrow("Only saved plans can be placed on calendar");
    });

    it("rejects when plan not found", async () => {
      mockGetSavedPlanById.mockResolvedValue(null);
      await expect(
        placePlanOnCalendar({ savedPlanId: "sp-1", coachId: "coach-1", clientId: "client-1", startDate: "2026-04-15" }),
      ).rejects.toThrow("Saved plan not found");
    });

    it("clones EVERY slot incl. rest (is_rest set), counts only workouts, day_of_week null", async () => {
      mockGetSavedPlanById.mockResolvedValue(makeSavedPlan());
      mockCreateAtomic.mockResolvedValue("new-plan-id");

      const sessionInsertQuery = makeSessionInsertQuery(["ts-1", "ts-2", "ts-3", "ts-rest"]);
      const groupInsertQuery = createMockQuery({ data: null, error: null });
      const exerciseInsertQuery = createMockQuery({ data: null, error: null });
      const eventUpsertQuery = createMockQuery({ data: [], error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === "training_sessions") return sessionInsertQuery as never;
        if (table === "training_exercise_groups") return groupInsertQuery as never;
        if (table === "training_exercises") return exerciseInsertQuery as never;
        if (table === "training_events") return eventUpsertQuery as never;
        return createMockQuery({ data: null, error: null }) as never;
      });

      const result = await placePlanOnCalendar({
        savedPlanId: "sp-1", coachId: "coach-1", clientId: "client-1", startDate: "2026-04-15",
      });

      expect(mockCreateAtomic).toHaveBeenCalledWith(
        expect.objectContaining({ name: "PPL Program", savedPlanId: "sp-1", effectiveFrom: "2026-04-15" }),
      );
      // All 4 slots cloned (3 workouts + 1 rest); only 3 counted as created.
      expect(sessionInsertQuery.insert).toHaveBeenCalledTimes(1);
      expect(insertedSlots(sessionInsertQuery)).toHaveLength(4);
      expect(result.sessionsCreated).toBe(3);
      for (const row of insertedSlots(sessionInsertQuery)) {
        expect(row.day_of_week).toBeNull();
      }
      const restInsert = insertedSlots(sessionInsertQuery).find((r) => r.is_rest === true);
      expect(restInsert).toBeDefined();
      expect(restInsert!.name).toBe("Rest");
      expect(insertedSlots(sessionInsertQuery).filter((r) => r.is_rest === false)).toHaveLength(3);
      // Only the 3 non-rest slots get exercises.
      // One batched statement carrying all three slots' groups, then one
      // carrying their exercises, each exercise naming its slot's group.
      expect(groupInsertQuery.insert).toHaveBeenCalledTimes(1);
      const groupRows = groupInsertQuery.insert.mock.calls[0][0] as Array<Record<string, unknown>>;
      expect(groupRows.map((g) => g.session_id)).toEqual(["ts-1", "ts-2", "ts-3"]);
      expect(groupInsertQuery.insert.mock.invocationCallOrder[0]).toBeLessThan(
        exerciseInsertQuery.insert.mock.invocationCallOrder[0],
      );
      expect(exerciseInsertQuery.insert).toHaveBeenCalledTimes(1);
      const exerciseRows = exerciseInsertQuery.insert.mock.calls[0][0] as Array<Record<string, unknown>>;
      expect(exerciseRows.map((e) => [e.session_id, e.group_id])).toEqual(
        groupRows.map((g) => [g.session_id, g.id]),
      );
      // Window = 4 slots = 4 days → Push, Pull, Legs (rest skipped) = 3 events.
      const events = eventUpsertQuery.upsert.mock.calls[0][0];
      expect(events).toHaveLength(3);
      for (const event of events) {
        expect(event.is_modified).toBe(false);
        expect(event.status).toBe("scheduled");
      }
      expect(result.planId).toBe("new-plan-id");
      expect(result.eventsCreated).toBe(3);
    });

    it("places exactly one pass of the program", async () => {
      mockGetSavedPlanById.mockResolvedValue(
        makeSavedPlan({
          sessions: [
            makeSession({ id: "a", name: "A", orderIndex: 0, groups: [] }),
            makeSession({ id: "b", name: "B", orderIndex: 1, groups: [] }),
            makeSession({ id: "c", name: "C", orderIndex: 2, groups: [] }),
          ],
        }),
      );
      mockCreateAtomic.mockResolvedValue("new-plan-id");
      const sessionInsertQuery = makeSessionInsertQuery(["ts-a", "ts-b", "ts-c"]);
      const eventUpsertQuery = createMockQuery({ data: [], error: null });
      mockFrom.mockImplementation((table: string) => {
        if (table === "training_sessions") return sessionInsertQuery as never;
        if (table === "training_events") return eventUpsertQuery as never;
        return createMockQuery({ data: null, error: null }) as never;
      });

      await placePlanOnCalendar({ savedPlanId: "sp-1", coachId: "coach-1", clientId: "client-1", startDate: "2026-04-15" });

      const events = eventUpsertQuery.upsert.mock.calls[0][0];
      expect(events.map((e: { date: string }) => e.date)).toEqual(["2026-04-15", "2026-04-16", "2026-04-17"]);
    });

    it("copies calorie_surplus_percentage from session, falls back to plan default; rest is null", async () => {
      mockGetSavedPlanById.mockResolvedValue(
        makeSavedPlan({
          defaultSurplusPercentage: 10,
          sessions: [
            makeSession({ id: "ss-1", orderIndex: 0, calorieSurplusPercentage: 20, groups: [] }),
            makeSession({ id: "ss-2", orderIndex: 1, calorieSurplusPercentage: null, groups: [] }),
            makeSession({ id: "ss-r", orderIndex: 2, isRest: true, calorieSurplusPercentage: 99, groups: [] }),
          ],
        }),
      );
      mockCreateAtomic.mockResolvedValue("new-plan-id");
      const sessionInsertQuery = makeSessionInsertQuery(["ts-1", "ts-2", "ts-r"]);
      const eventUpsertQuery = createMockQuery({ data: [], error: null });
      mockFrom.mockImplementation((table: string) => {
        if (table === "training_sessions") return sessionInsertQuery as never;
        if (table === "training_events") return eventUpsertQuery as never;
        return createMockQuery({ data: null, error: null }) as never;
      });

      await placePlanOnCalendar({ savedPlanId: "sp-1", coachId: "coach-1", clientId: "client-1", startDate: "2026-04-15" });

      expect(insertedSlots(sessionInsertQuery)[0].calorie_surplus_percentage).toBe(20);
      expect(insertedSlots(sessionInsertQuery)[1].calorie_surplus_percentage).toBe(10);
      // Rest slot surplus is nulled regardless of the source value.
      expect(insertedSlots(sessionInsertQuery)[2].calorie_surplus_percentage).toBeNull();
    });

    it("passes effectiveFrom + windowEnd to the atomic RPC, capped at the next plan's start", async () => {
      // A 28-slot (4-week) program would run to 2026-05-12, but a later plan
      // starts 2026-05-01 so getNextPlanStartCap caps the window at 2026-04-30.
      mockGetSavedPlanById.mockResolvedValue(
        makeSavedPlan({
          sessions: Array.from({ length: 28 }, (_, i) =>
            makeSession({ id: `d-${i}`, weekIndex: Math.floor(i / 7), orderIndex: i % 7, groups: [] }),
          ),
        }),
      );
      mockCreateAtomic.mockResolvedValue("new-plan-id");
      mockGetNextPlanStartCap.mockResolvedValue("2026-04-30");
      const sessionInsertQuery = makeSessionInsertQuery(Array.from({ length: 28 }, (_, i) => `ts-${i}`));
      const eventUpsertQuery = createMockQuery({ data: [], error: null });
      mockFrom.mockImplementation((table: string) => {
        if (table === "training_sessions") return sessionInsertQuery as never;
        if (table === "training_events") return eventUpsertQuery as never;
        return createMockQuery({ data: null, error: null }) as never;
      });

      await placePlanOnCalendar({ savedPlanId: "sp-1", coachId: "coach-1", clientId: "client-1", startDate: "2026-04-15" });

      expect(mockGetNextPlanStartCap).toHaveBeenCalledWith("client-1", "2026-04-15");
      expect(mockCreateAtomic).toHaveBeenCalledWith(
        expect.objectContaining({ effectiveFrom: "2026-04-15", windowEnd: "2026-04-30" }),
      );
    });

    it("is idempotent on re-place: same window + same event count across two placements", async () => {
      const savedPlan = makeSavedPlan({
        sessions: [makeSession({ id: "ss-1", orderIndex: 0, calorieSurplusPercentage: 15, groups: [] })],
      });
      mockGetSavedPlanById.mockResolvedValue(savedPlan);
      mockCreateAtomic.mockResolvedValue("new-plan-id");
      const eventUpsertQuery = createMockQuery({ data: [], error: null });
      mockFrom.mockImplementation((table: string) => {
        if (table === "training_sessions") return makeSessionInsertQuery(["ts-1"]) as never;
        if (table === "training_events") return eventUpsertQuery as never;
        return createMockQuery({ data: null, error: null }) as never;
      });

      const args = { savedPlanId: "sp-1", coachId: "coach-1", clientId: "client-1", startDate: "2026-04-15" };
      await placePlanOnCalendar(args);
      await placePlanOnCalendar(args);

      expect(mockCreateAtomic).toHaveBeenCalledTimes(2);
      const first = mockCreateAtomic.mock.calls[0][0];
      const second = mockCreateAtomic.mock.calls[1][0];
      expect(second.effectiveFrom).toBe(first.effectiveFrom);
      expect(second.windowEnd).toBe(first.windowEnd);
      const firstRows = eventUpsertQuery.upsert.mock.calls[0][0];
      const secondRows = eventUpsertQuery.upsert.mock.calls[1][0];
      expect(secondRows.length).toBe(firstRows.length);
    });

    it("writes calorie_surplus_percentage onto generated event rows (INVARIANT 2)", async () => {
      mockGetSavedPlanById.mockResolvedValue(
        makeSavedPlan({
          defaultSurplusPercentage: 10,
          sessions: [
            makeSession({ id: "ss-1", orderIndex: 0, calorieSurplusPercentage: 25, groups: [] }),
            makeSession({ id: "ss-2", orderIndex: 1, calorieSurplusPercentage: 25, groups: [] }),
            makeSession({ id: "ss-3", orderIndex: 2, calorieSurplusPercentage: 25, groups: [] }),
          ],
        }),
      );
      mockCreateAtomic.mockResolvedValue("new-plan-id");
      const eventUpsertQuery = createMockQuery({ data: [], error: null });
      mockFrom.mockImplementation((table: string) => {
        if (table === "training_sessions") return makeSessionInsertQuery(["ts-1", "ts-2", "ts-3"]) as never;
        if (table === "training_events") return eventUpsertQuery as never;
        return createMockQuery({ data: null, error: null }) as never;
      });

      await placePlanOnCalendar({ savedPlanId: "sp-1", coachId: "coach-1", clientId: "client-1", startDate: "2026-04-15" });

      const eventRows = eventUpsertQuery.upsert.mock.calls[0][0];
      expect(eventRows.length).toBe(3);
      for (const row of eventRows) expect(row.calorie_surplus_percentage).toBe(25);
    });

    it("preserves exercise_id FK from saved exercises", async () => {
      mockGetSavedPlanById.mockResolvedValue(
        makeSavedPlan({
          sessions: [
            makeSession({
              id: "ss-1", orderIndex: 0,
              groups: loneGroups(
                makeExercise({ exerciseId: "catalog-abc", name: "Bench Press" }),
                makeExercise({ id: "ex-2", exerciseId: null, name: "Custom Move" }),
              ),
            }),
          ],
        }),
      );
      mockCreateAtomic.mockResolvedValue("new-plan-id");
      const exerciseInsertQuery = createMockQuery({ data: null, error: null });
      mockFrom.mockImplementation((table: string) => {
        if (table === "training_sessions") return makeSessionInsertQuery(["ts-1"]) as never;
        if (table === "training_exercises") return exerciseInsertQuery as never;
        if (table === "training_events") return createMockQuery({ data: [], error: null }) as never;
        return createMockQuery({ data: null, error: null }) as never;
      });

      await placePlanOnCalendar({ savedPlanId: "sp-1", coachId: "coach-1", clientId: "client-1", startDate: "2026-04-15" });

      const exerciseCall = exerciseInsertQuery.insert.mock.calls[0][0];
      expect(exerciseCall[0].exercise_id).toBe("catalog-abc");
      expect(exerciseCall[1].exercise_id).toBeNull();
    });

    it("SURVIVAL: set_specs + video_url survive a pristine apply (clone from SavedExercise)", async () => {
      const specs = [
        { set_number: 1, set_type: "warmup" },
        { set_number: 2, set_type: "working", reps_min: 6, reps_max: 8 },
        { set_number: 3, set_type: "drop", drops: [{ weight: 100, reps: 8 }] },
      ];
      mockGetSavedPlanById.mockResolvedValue(
        makeSavedPlan({
          sessions: [
            makeSession({
              id: "ss-1", orderIndex: 0,
              groups: loneGroups(makeExercise({ setSpecs: specs as never, videoUrl: "https://demo/bench" })),
            }),
          ],
        }),
      );
      mockCreateAtomic.mockResolvedValue("new-plan-id");
      const exerciseInsertQuery = createMockQuery({ data: null, error: null });
      mockFrom.mockImplementation((table: string) => {
        if (table === "training_sessions") return makeSessionInsertQuery(["ts-1"]) as never;
        if (table === "training_exercises") return exerciseInsertQuery as never;
        if (table === "training_events") return createMockQuery({ data: [], error: null }) as never;
        return createMockQuery({ data: null, error: null }) as never;
      });

      await placePlanOnCalendar({ savedPlanId: "sp-1", coachId: "coach-1", clientId: "client-1", startDate: "2026-04-15" });

      const inserted = exerciseInsertQuery.insert.mock.calls[0][0];
      expect(inserted[0].set_specs).toEqual(specs);
      expect(inserted[0].video_url).toBe("https://demo/bench");
    });
  });

  // =========================================================================
  // program event generation (the date-walk over the whole authored program)
  // =========================================================================

  describe("program event generation", () => {
    it("single-week program places one pass via the date-walk", async () => {
      // PPL + Rest: Push(0), Pull(1), Legs(2), Rest(3) → 4 days, rest emits nothing.
      mockGetSavedPlanById.mockResolvedValue(
        makeSavedPlan({
          sessions: [
            makeSession({ id: "ss-push", name: "Push", orderIndex: 0, groups: [] }),
            makeSession({ id: "ss-pull", name: "Pull", orderIndex: 1, groups: [] }),
            makeSession({ id: "ss-legs", name: "Legs", orderIndex: 2, groups: [] }),
            makeSession({ id: "ss-rest", name: "Rest", orderIndex: 3, isRest: true, groups: [] }),
          ],
        }),
      );
      mockCreateAtomic.mockResolvedValue("new-plan-id");
      const sessionInsertQuery = makeSessionInsertQuery(["ts-push", "ts-pull", "ts-legs", "ts-rest"]);
      const eventUpsertQuery = createMockQuery({ data: [], error: null });
      mockFrom.mockImplementation((table: string) => {
        if (table === "training_sessions") return sessionInsertQuery as never;
        if (table === "training_events") return eventUpsertQuery as never;
        return createMockQuery({ data: null, error: null }) as never;
      });

      await placePlanOnCalendar({ savedPlanId: "sp-1", coachId: "coach-1", clientId: "client-1", startDate: "2026-04-15" });

      const events = eventUpsertQuery.upsert.mock.calls[0][0] as { date: string }[];
      // 4 days; rest on day 3 (04-18) → 3 events.
      expect(events.map((e) => e.date)).toEqual([
        "2026-04-15", "2026-04-16", "2026-04-17",
      ]);
    });

    it("GUARDRAIL: a rest slot never emits a training_event", async () => {
      // Alternating workout/rest across 6 slots → 6 days, 3 events, none for rest.
      mockGetSavedPlanById.mockResolvedValue(
        makeSavedPlan({
          sessions: [
            makeSession({ id: "ss-w0", name: "Workout", orderIndex: 0, groups: [] }),
            makeSession({ id: "ss-r1", name: "Rest", orderIndex: 1, isRest: true, groups: [] }),
            makeSession({ id: "ss-w2", name: "Workout", orderIndex: 2, groups: [] }),
            makeSession({ id: "ss-r3", name: "Rest", orderIndex: 3, isRest: true, groups: [] }),
            makeSession({ id: "ss-w4", name: "Workout", orderIndex: 4, groups: [] }),
            makeSession({ id: "ss-r5", name: "Rest", orderIndex: 5, isRest: true, groups: [] }),
          ],
        }),
      );
      mockCreateAtomic.mockResolvedValue("new-plan-id");
      const sessionInsertQuery = makeSessionInsertQuery(["ts-w0", "ts-r1", "ts-w2", "ts-r3", "ts-w4", "ts-r5"]);
      const eventUpsertQuery = createMockQuery({ data: [], error: null });
      mockFrom.mockImplementation((table: string) => {
        if (table === "training_sessions") return sessionInsertQuery as never;
        if (table === "training_events") return eventUpsertQuery as never;
        return createMockQuery({ data: null, error: null }) as never;
      });

      await placePlanOnCalendar({ savedPlanId: "sp-1", coachId: "coach-1", clientId: "client-1", startDate: "2026-04-15" });

      const events = eventUpsertQuery.upsert.mock.calls[0][0] as { training_session_id: string }[];
      expect(events).toHaveLength(3);
      expect(events.map((e) => e.training_session_id)).toEqual(["ts-w0", "ts-w2", "ts-w4"]);
    });

    it("multi-week program: all weeks place in (week_index, order_index) order", async () => {
      // Week 0: A(0), B(1); Week 1: C(0), D(1). Ordered program = A,B,C,D.
      mockGetSavedPlanById.mockResolvedValue(
        makeSavedPlan({
          sessions: [
            makeSession({ id: "a", name: "A", weekIndex: 0, orderIndex: 0, groups: [] }),
            makeSession({ id: "b", name: "B", weekIndex: 0, orderIndex: 1, groups: [] }),
            makeSession({ id: "c", name: "C", weekIndex: 1, orderIndex: 0, groups: [] }),
            makeSession({ id: "d", name: "D", weekIndex: 1, orderIndex: 1, groups: [] }),
          ],
        }),
      );
      mockCreateAtomic.mockResolvedValue("new-plan-id");
      const sessionInsertQuery = makeSessionInsertQuery(["ts-a", "ts-b", "ts-c", "ts-d"]);
      const eventUpsertQuery = createMockQuery({ data: [], error: null });
      mockFrom.mockImplementation((table: string) => {
        if (table === "training_sessions") return sessionInsertQuery as never;
        if (table === "training_events") return eventUpsertQuery as never;
        return createMockQuery({ data: null, error: null }) as never;
      });

      await placePlanOnCalendar({ savedPlanId: "sp-1", coachId: "coach-1", clientId: "client-1", startDate: "2026-04-15" });

      // Session inserts are ordered by (week_index, order_index).
      expect(insertedSlots(sessionInsertQuery).map((r) => r.name)).toEqual(["A", "B", "C", "D"]);
      expect(insertedSlots(sessionInsertQuery).map((r) => r.week_index)).toEqual([0, 0, 1, 1]);
      const events = eventUpsertQuery.upsert.mock.calls[0][0] as { training_session_id: string }[];
      expect(events.map((e) => e.training_session_id)).toEqual([
        "ts-a", "ts-b", "ts-c", "ts-d",
      ]);
    });

    it("NO COMPRESSION: an all-rest week in the middle + a trailing rest still land dates correctly", async () => {
      // Week 0: A(0), B(1); Week 1: Rest(0), Rest(1) [all-rest]; Week 2: C(0), Rest(1) [trailing].
      // Ordered program = A, B, rest, rest, C, rest (6 slots) = 6 days.
      mockGetSavedPlanById.mockResolvedValue(
        makeSavedPlan({
          sessions: [
            makeSession({ id: "a", name: "A", weekIndex: 0, orderIndex: 0, groups: [] }),
            makeSession({ id: "b", name: "B", weekIndex: 0, orderIndex: 1, groups: [] }),
            makeSession({ id: "r1", name: "Rest", weekIndex: 1, orderIndex: 0, isRest: true, groups: [] }),
            makeSession({ id: "r2", name: "Rest", weekIndex: 1, orderIndex: 1, isRest: true, groups: [] }),
            makeSession({ id: "c", name: "C", weekIndex: 2, orderIndex: 0, groups: [] }),
            makeSession({ id: "r3", name: "Rest", weekIndex: 2, orderIndex: 1, isRest: true, groups: [] }),
          ],
        }),
      );
      mockCreateAtomic.mockResolvedValue("new-plan-id");
      const sessionInsertQuery = makeSessionInsertQuery(["ts-a", "ts-b", "ts-r1", "ts-r2", "ts-c", "ts-r3"]);
      const eventUpsertQuery = createMockQuery({ data: [], error: null });
      mockFrom.mockImplementation((table: string) => {
        if (table === "training_sessions") return sessionInsertQuery as never;
        if (table === "training_events") return eventUpsertQuery as never;
        return createMockQuery({ data: null, error: null }) as never;
      });

      await placePlanOnCalendar({ savedPlanId: "sp-1", coachId: "coach-1", clientId: "client-1", startDate: "2026-04-15" });

      const events = eventUpsertQuery.upsert.mock.calls[0][0] as { date: string }[];
      const dates = events.map((e) => e.date);
      // Rest days consume their date but emit no event; C lands AFTER the
      // all-rest week — no compression.
      expect(dates).toEqual([
        "2026-04-15", "2026-04-16", "2026-04-19", // week0 A,B ; week2 C
      ]);
      expect(dates).not.toContain("2026-04-17"); // all-rest week
      expect(dates).not.toContain("2026-04-18");
      expect(dates).not.toContain("2026-04-20"); // trailing rest
    });
  });

  // =========================================================================
  // placeSessionOnCalendar
  // =========================================================================

  describe("placeSessionOnCalendar", () => {
    it("creates session (is_rest false), exercises, and event with is_modified = true", async () => {
      const savedSessionRow = {
        id: "ss-1", coach_id: "coach-1", saved_plan_id: null, name: "Push Day", focus: "chest",
        order_index: 0, week_index: 0, is_rest: false, estimated_duration_minutes: 60,
        calorie_surplus_percentage: 15, notes: null, session_type: "training",
        coach_saved_exercise_groups: [
          {
            id: "sg-1", saved_session_id: "ss-1", order_index: 0, format: "straight_sets", rounds: null,
            time_cap_seconds: null, interval_seconds: null, rest_between_exercises_seconds: null,
            rest_between_rounds_seconds: null, notes: null,
            coach_saved_exercises: [
              {
                id: "se-1", group_id: "sg-1", exercise_id: "catalog-1", name: "Bench Press", order_index: 0, sets: 4,
                reps_min: 8, reps_max: 12, reps_target: null, rpe_target: 8, percentage_1rm: null,
                tempo: null, rest_seconds: 90, notes: null, is_warmup: false,
                set_specs: null, video_url: null,
              },
            ],
          },
        ],
      };
      const sessionFetchQuery = createMockQuery({ data: savedSessionRow, error: null });
      const sessionInsertQuery = createMockQuery({ data: { id: "ts-new" }, error: null });
      const groupInsertQuery = createMockQuery({ data: null, error: null });
      const exerciseInsertQuery = createMockQuery({ data: null, error: null });
      const eventInsertQuery = createMockQuery({ data: { id: "evt-new" }, error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === "coach_saved_sessions") return sessionFetchQuery as never;
        if (table === "training_sessions") return sessionInsertQuery as never;
        if (table === "training_exercise_groups") return groupInsertQuery as never;
        if (table === "training_exercises") return exerciseInsertQuery as never;
        if (table === "training_events") return eventInsertQuery as never;
        return createMockQuery({ data: null, error: null }) as never;
      });

      const result = await placeSessionOnCalendar({
        savedSessionId: "ss-1", coachId: "coach-1", clientId: "client-1", planId: "plan-1", targetDate: "2026-04-20",
      });

      expect(result.sessionId).toBe("ts-new");
      expect(result.eventId).toBe("evt-new");
      expect(sessionInsertQuery.insert).toHaveBeenCalledWith(
        expect.objectContaining({ plan_id: "plan-1", day_of_week: null, is_rest: false, calorie_surplus_percentage: 15 }),
      );
      // The template is read with its groups and their exercises; the clone
      // writes the group, then the exercise under it.
      expect(sessionFetchQuery.select).toHaveBeenCalledWith(`*, ${SAVED_SESSION_GROUPS_EMBED}`);
      const groupInsert = groupInsertQuery.insert.mock.calls[0][0];
      expect(groupInsert).toEqual([
        expect.objectContaining({ session_id: "ts-new", order_index: 0, format: "straight_sets" }),
      ]);
      const exInsert = exerciseInsertQuery.insert.mock.calls[0][0];
      expect(exInsert[0].exercise_id).toBe("catalog-1");
      expect(exInsert[0].group_id).toBe(groupInsert[0].id);
      expect(eventInsertQuery.insert).toHaveBeenCalledWith(
        expect.objectContaining({ is_modified: true, date: "2026-04-20", status: "scheduled", calorie_surplus_percentage: 15 }),
      );
    });

    // A saved session's (week_index, order_index) describe the program it was
    // AUTHORED in. Copying them into a different plan is meaningless, and a
    // non-zero week_index is actively harmful: getClientTrainingPlan treats a
    // plan as self-describing if ANY entry has week_index > 0, so one dropped
    // session could flip a whole flat plan onto that branch and change how its
    // rest days render. Placement must derive the slot from the TARGET plan.
    function mockPlaceSession(opts: {
      templateWeekIndex: number;
      templateOrderIndex: number;
      lastSlot: { week_index: number; order_index: number } | null;
    }) {
      const savedSessionRow = {
        id: "ss-1", coach_id: "coach-1", saved_plan_id: null, name: "Push Day", focus: null,
        order_index: opts.templateOrderIndex, week_index: opts.templateWeekIndex, is_rest: false,
        estimated_duration_minutes: 60, calorie_surplus_percentage: null, notes: null,
        session_type: "training", coach_saved_exercise_groups: [],
      };
      // The slot lookup ends in .maybeSingle(); the insert ends in .select().single().
      const trainingSessionsQuery = {
        ...createMockQuery({ data: { id: "ts-new" }, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: opts.lastSlot, error: null }),
        single: vi.fn().mockResolvedValue({ data: { id: "ts-new" }, error: null }),
      };
      mockFrom.mockImplementation((table: string) => {
        if (table === "coach_saved_sessions") return createMockQuery({ data: savedSessionRow, error: null }) as never;
        if (table === "training_sessions") return trainingSessionsQuery as never;
        if (table === "training_events") return createMockQuery({ data: { id: "evt-new" }, error: null }) as never;
        return createMockQuery({ data: null, error: null }) as never;
      });
      return trainingSessionsQuery;
    }

    it("joins a day that already holds sessions, last — the day is read before anything is cloned", async () => {
      mockPlaceSession({ templateWeekIndex: 0, templateOrderIndex: 0, lastSlot: null });
      // The day's last session sits at place 1: the drop takes place 2.
      const eventsQuery = {
        ...createMockQuery({ data: { id: "evt-new" }, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: { day_order: 1 }, error: null }),
        single: vi.fn().mockResolvedValue({ data: { id: "evt-new" }, error: null }),
      };
      const fallback = mockFrom.getMockImplementation()!;
      mockFrom.mockImplementation(((table: string) =>
        table === "training_events"
          ? eventsQuery
          : fallback(table as Parameters<typeof fallback>[0])) as never);

      await placeSessionOnCalendar({
        savedSessionId: "ss-1", coachId: "coach-1", clientId: "client-1", planId: "plan-1", targetDate: "2026-04-20",
      });

      expect(eventsQuery.eq).toHaveBeenCalledWith("client_id", "client-1");
      expect(eventsQuery.eq).toHaveBeenCalledWith("date", "2026-04-20");
      expect(eventsQuery.order).toHaveBeenCalledWith("day_order", { ascending: false });
      expect(eventsQuery.insert).toHaveBeenCalledWith(
        expect.objectContaining({ date: "2026-04-20", day_order: 2, status: "scheduled" }),
      );
    });

    it("appends after the target plan's last slot instead of copying the template's indices", async () => {
      const q = mockPlaceSession({
        templateWeekIndex: 0, templateOrderIndex: 3,
        lastSlot: { week_index: 2, order_index: 20 },
      });

      await placeSessionOnCalendar({
        savedSessionId: "ss-1", coachId: "coach-1", clientId: "client-1", planId: "plan-1", targetDate: "2026-04-20",
      });

      expect(q.insert).toHaveBeenCalledWith(
        expect.objectContaining({ week_index: 2, order_index: 21 }),
      );
    });

    it("does NOT flip a flat plan's client read when the template was authored in a later week", async () => {
      const q = mockPlaceSession({
        templateWeekIndex: 3, templateOrderIndex: 21, // week 4 of some other program
        lastSlot: { week_index: 0, order_index: 4 },  // target plan is flat
      });

      await placeSessionOnCalendar({
        savedSessionId: "ss-1", coachId: "coach-1", clientId: "client-1", planId: "plan-1", targetDate: "2026-04-20",
      });

      // week_index 0, NOT the template's 3 — the flat plan stays flat.
      expect(q.insert).toHaveBeenCalledWith(
        expect.objectContaining({ week_index: 0, order_index: 5 }),
      );
    });

    it("starts at slot 0 when the target plan has no sessions yet", async () => {
      const q = mockPlaceSession({
        templateWeekIndex: 2, templateOrderIndex: 14, lastSlot: null,
      });

      await placeSessionOnCalendar({
        savedSessionId: "ss-1", coachId: "coach-1", clientId: "client-1", planId: "plan-1", targetDate: "2026-04-20",
      });

      expect(q.insert).toHaveBeenCalledWith(
        expect.objectContaining({ week_index: 0, order_index: 0 }),
      );
    });
  });

  // =========================================================================
  // placeInlineEditedPlanOnCalendar (apply-without-overwrite)
  // =========================================================================

  describe("placeInlineEditedPlanOnCalendar", () => {
    function makeInlinePlan(overrides?: Partial<InlinePlanBody>): InlinePlanBody {
      return {
        name: "Edited PPL",
        splitType: "push_pull_legs",
        programDurationWeeks: 1,
        defaultSurplusPercentage: 10,
        sessions: [
          {
            name: "Push", focus: "chest", orderIndex: 0, isRest: false, estimatedDurationMinutes: 60,
            calorieSurplusPercentage: 15, notes: null, sessionType: "training",
            groups: [{ ...STRAIGHT_SETS, exercises: [{ name: "Bench", exerciseId: "catalog-1", sets: 3 }] }],
          },
        ],
        ...overrides,
      };
    }

    function wireInlineMocks(exerciseCatalogIds: string[]) {
      const exercisesQuery = createMockQuery({ data: exerciseCatalogIds.map((id) => ({ id })), error: null });
      const sessionInsertQuery = makeSessionInsertQuery(["ts-1", "ts-2", "ts-3"]);
      const exerciseInsertQuery = createMockQuery({ data: null, error: null });
      const eventUpsertQuery = createMockQuery({ data: [], error: null });
      const libraryQuery = createMockQuery({ data: null, error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === "exercises") return exercisesQuery as never;
        if (table === "training_sessions") return sessionInsertQuery as never;
        if (table === "training_exercises") return exerciseInsertQuery as never;
        if (table === "training_events") return eventUpsertQuery as never;
        if (table === "coach_saved_sessions") return libraryQuery as never;
        if (table === "coach_saved_exercise_groups") return libraryQuery as never;
        if (table === "coach_saved_exercises") return libraryQuery as never;
        if (table === "coach_saved_plans") return libraryQuery as never;
        return createMockQuery({ data: null, error: null }) as never;
      });

      return { sessionInsertQuery, exerciseInsertQuery, eventUpsertQuery, libraryQuery };
    }

    it("places with saved_plan_id unset, never mutates the library, materializes events, preserves surplus", async () => {
      mockCreateAtomic.mockResolvedValue("new-plan-id");
      const { sessionInsertQuery, eventUpsertQuery, libraryQuery } = wireInlineMocks(["catalog-1"]);

      const result = await placeInlineEditedPlanOnCalendar({
        plan: makeInlinePlan(), coachId: "coach-1", clientId: "client-1", startDate: "2026-04-15",
      });

      expect(mockCreateAtomic).toHaveBeenCalledWith(expect.objectContaining({ savedPlanId: undefined }));
      expect(libraryQuery.delete).not.toHaveBeenCalled();
      expect(libraryQuery.insert).not.toHaveBeenCalled();
      expect(insertedSlots(sessionInsertQuery)).toContainEqual(
        expect.objectContaining({ calorie_surplus_percentage: 15, is_rest: false }),
      );
      const eventRows = eventUpsertQuery.upsert.mock.calls[0][0];
      expect(eventRows.length).toBeGreaterThan(0);
      for (const row of eventRows) expect(row.calorie_surplus_percentage).toBe(15);
      expect(result.planId).toBe("new-plan-id");
    });

    it("the authored slot count drives the window (programDurationWeeks does NOT extend it)", async () => {
      mockCreateAtomic.mockResolvedValue("new-plan-id");
      wireInlineMocks(["catalog-1"]);

      // A 1-slot program with programDurationWeeks = 12 places exactly ONE day —
      // the authored slot count is the only length knob.
      await placeInlineEditedPlanOnCalendar({
        plan: makeInlinePlan({ programDurationWeeks: 12 }), coachId: "coach-1", clientId: "client-1", startDate: "2026-04-15",
      });

      expect(mockCreateAtomic.mock.calls[0][0].windowEnd).toBe("2026-04-15");
    });

    it("nulls an exercise_id that is not in the coach's own+global catalog", async () => {
      mockCreateAtomic.mockResolvedValue("new-plan-id");
      const { exerciseInsertQuery } = wireInlineMocks(["catalog-1"]);

      await placeInlineEditedPlanOnCalendar({
        plan: makeInlinePlan({
          sessions: [
            {
              name: "Push", focus: null, orderIndex: 0, isRest: false, estimatedDurationMinutes: null,
              calorieSurplusPercentage: null, notes: null, sessionType: "training",
              groups: [
                { ...STRAIGHT_SETS, exercises: [{ name: "Owned", exerciseId: "catalog-1", sets: 3 }] },
                { ...STRAIGHT_SETS, exercises: [{ name: "Foreign", exerciseId: "not-in-catalog", sets: 3 }] },
              ],
            },
          ],
        }),
        coachId: "coach-1", clientId: "client-1", startDate: "2026-04-15",
      });

      const inserted = exerciseInsertQuery.insert.mock.calls[0][0];
      expect(inserted[0].exercise_id).toBe("catalog-1");
      expect(inserted[1].exercise_id).toBeNull();
    });
  });

  // =========================================================================
  // deriveFrequencyPerWeek
  // =========================================================================

  describe("deriveFrequencyPerWeek", () => {
    it("counts non-rest slots in a single week", () => {
      expect(
        deriveFrequencyPerWeek([
          { isRest: false },
          { isRest: true },
          { isRest: false },
        ]),
      ).toBe(2);
    });

    it("derives the per-week average for a multi-week program (3 weeks x 4/wk -> 4)", () => {
      const sessions = [0, 1, 2].flatMap((weekIndex) =>
        [0, 1, 2, 3, 4, 5, 6].map((orderIndex) => ({
          weekIndex,
          // 4 training + 3 rest per week. Per-week AVERAGE, NOT the raw
          // non-rest total — the total would fail training_plans' CHECK (1..7)
          // at apply time.
          isRest: orderIndex >= 4,
        })),
      );
      expect(deriveFrequencyPerWeek(sessions)).toBe(4);
    });

    it("clamps an all-rest program up to frequency 1", () => {
      expect(
        deriveFrequencyPerWeek(
          [0, 1, 2, 3, 4, 5, 6].map(() => ({ isRest: true })),
        ),
      ).toBe(1);
    });

    it("clamps a dense single-week program down to frequency 7", () => {
      // 10 non-rest slots in one week: clamp to the CHECK's ceiling of 7.
      expect(
        deriveFrequencyPerWeek(
          Array.from({ length: 10 }, () => ({ isRest: false })),
        ),
      ).toBe(7);
    });
  });
});

// ===========================================================================
// The block is the placement's length knob (block-as-program, commit 1).
// ===========================================================================

describe("library-placement-service: the block bounds the placement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetNextPlanStartCap.mockResolvedValue(null);
    mockGetBlockBound.mockResolvedValue(null);
  });

  /** A 3-slot program: two workouts and a rest day. */
  function threeSlotPlan() {
    return makeSavedPlan({
      sessions: [
        makeSession({ id: "s1", name: "Upper", orderIndex: 0, groups: loneGroups(makeExercise()) }),
        makeSession({ id: "s2", name: "Lower", orderIndex: 1, groups: loneGroups(makeExercise()) }),
        makeSession({ id: "s3", name: "Rest", orderIndex: 2, isRest: true, groups: [] }),
      ],
    });
  }

  function wire(ids: string[]) {
    const sessionInsertQuery = makeSessionInsertQuery(ids);
    const exerciseInsertQuery = createMockQuery({ data: null, error: null });
    const eventUpsertQuery = createMockQuery({ data: [], error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "training_sessions") return sessionInsertQuery as never;
      if (table === "training_exercises") return exerciseInsertQuery as never;
      if (table === "training_events") return eventUpsertQuery as never;
      return createMockQuery({ data: null, error: null }) as never;
    });
    return { sessionInsertQuery, exerciseInsertQuery, eventUpsertQuery };
  }

  it("refuses the placement when the client's blocks can't be read, before anything is written", async () => {
    // The window is resolved first, so a failed blocks read stops the save
    // rather than placing a program that runs straight through a block.
    mockGetSavedPlanById.mockResolvedValue(threeSlotPlan());
    mockCreateAtomic.mockResolvedValue("new-plan-id");
    mockGetBlockBound.mockRejectedValue(new Error(BLOCKS_UNREADABLE));
    wire(["ts-1", "ts-2", "ts-3"]);

    await expect(
      placePlanOnCalendar({
        savedPlanId: "sp-1", coachId: "coach-1", clientId: "client-1", startDate: "2026-09-07",
      }),
    ).rejects.toThrow(BLOCKS_UNREADABLE);

    expect(mockCreateAtomic).not.toHaveBeenCalled();
  });

  it("repeats a short program to fill its block, cloning every cycle its own rows", async () => {
    // 3-slot program in a 9-day block (2026-09-07 → 2026-09-15): three cycles.
    mockGetSavedPlanById.mockResolvedValue(threeSlotPlan());
    mockCreateAtomic.mockResolvedValue("new-plan-id");
    mockGetBlockBound.mockResolvedValue({ kind: "covering", endsOn: "2026-09-15" });
    const { sessionInsertQuery, eventUpsertQuery } = wire(
      Array.from({ length: 9 }, (_, i) => `ts-${i + 1}`),
    );

    const result = await placePlanOnCalendar({
      savedPlanId: "sp-1", coachId: "coach-1", clientId: "client-1", startDate: "2026-09-07",
    });

    const slots = insertedSlots(sessionInsertQuery);
    expect(slots).toHaveLength(9);
    expect(slots.map((r) => r.name)).toEqual([
      "Upper", "Lower", "Rest", "Upper", "Lower", "Rest", "Upper", "Lower", "Rest",
    ]);
    // CLONED, not shared: nine distinct rows, so cycle three can be progressed
    // past cycle one. Sharing would make one edit rewrite every cycle.
    expect(new Set(slots.map((r) => `${r.week_index}:${r.order_index}`)).size).toBe(9);
    // Six workouts on the calendar; the three rest slots consume a day and emit
    // nothing.
    expect(result.eventsCreated).toBe(6);
    expect(eventUpsertQuery.upsert.mock.calls[0][0]).toHaveLength(6);
  });

  it("cuts a program longer than its block at the block's last day", async () => {
    // The same 3-slot program in a 2-day block: the third slot is never placed.
    mockGetSavedPlanById.mockResolvedValue(threeSlotPlan());
    mockCreateAtomic.mockResolvedValue("new-plan-id");
    mockGetBlockBound.mockResolvedValue({ kind: "covering", endsOn: "2026-09-08" });
    const { sessionInsertQuery } = wire(["ts-1", "ts-2"]);

    await placePlanOnCalendar({
      savedPlanId: "sp-1", coachId: "coach-1", clientId: "client-1", startDate: "2026-09-07",
    });

    expect(insertedSlots(sessionInsertQuery).map((r) => r.name)).toEqual(["Upper", "Lower"]);
  });

  it("stops a program placed in a gap the day before the next block", async () => {
    // The same 3-slot program placed on 2026-09-07 with an empty block opening
    // on 2026-09-09: two slots land, the third would have been the block's.
    mockGetSavedPlanById.mockResolvedValue(threeSlotPlan());
    mockCreateAtomic.mockResolvedValue("new-plan-id");
    mockGetBlockBound.mockResolvedValue({ kind: "next", startsOn: "2026-09-09" });
    const { sessionInsertQuery } = wire(["ts-1", "ts-2"]);

    await placePlanOnCalendar({
      savedPlanId: "sp-1", coachId: "coach-1", clientId: "client-1", startDate: "2026-09-07",
    });

    expect(insertedSlots(sessionInsertQuery).map((r) => r.name)).toEqual(["Upper", "Lower"]);
    expect(mockCreateAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ windowEnd: "2026-09-08" }),
    );
  });

  it("places one pass when no block covers the start date", async () => {
    mockGetSavedPlanById.mockResolvedValue(threeSlotPlan());
    mockCreateAtomic.mockResolvedValue("new-plan-id");
    const { sessionInsertQuery } = wire(["ts-1", "ts-2", "ts-3"]);

    await placePlanOnCalendar({
      savedPlanId: "sp-1", coachId: "coach-1", clientId: "client-1", startDate: "2026-09-07",
    });

    expect(insertedSlots(sessionInsertQuery)).toHaveLength(3);
  });

  it("records the PLACED length on the plan row, not the authored one", async () => {
    // A 3-day program filling a 9-day block is a 2-week placement; the Overview
    // chip derives its "Ended" date from this column and would otherwise
    // contradict the calendar.
    mockGetSavedPlanById.mockResolvedValue(threeSlotPlan());
    mockCreateAtomic.mockResolvedValue("new-plan-id");
    mockGetBlockBound.mockResolvedValue({ kind: "covering", endsOn: "2026-09-15" });
    wire(Array.from({ length: 9 }, (_, i) => `ts-${i + 1}`));

    await placePlanOnCalendar({
      savedPlanId: "sp-1", coachId: "coach-1", clientId: "client-1", startDate: "2026-09-07",
    });

    expect(mockCreateAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ programDurationWeeks: 2, windowEnd: "2026-09-15" }),
    );
  });

  it("refuses a template carrying two slots at one position rather than mis-linking exercises", async () => {
    // The group batch is keyed on (week_index, order_index); a duplicate
    // would hand one row both slots' groups and leave the other empty.
    mockGetSavedPlanById.mockResolvedValue(
      makeSavedPlan({
        sessions: [
          makeSession({ id: "d1", name: "One", orderIndex: 0, groups: loneGroups(makeExercise()) }),
          makeSession({ id: "d2", name: "Two", orderIndex: 0, groups: loneGroups(makeExercise()) }),
        ],
      }),
    );
    mockCreateAtomic.mockResolvedValue("new-plan-id");
    wire(["ts-1", "ts-2"]);

    await expect(
      placePlanOnCalendar({
        savedPlanId: "sp-1", coachId: "coach-1", clientId: "client-1", startDate: "2026-09-07",
      }),
    ).rejects.toThrow("two sessions at the same position");
  });
});

// ===========================================================================
// A placement supersedes the earlier programs (migration 167).
// ===========================================================================

describe("library-placement-service: the placement supersedes the earlier programs", () => {
  const EARLIER = [{ id: "old-1", effective_until: "2026-06-30", status: "active" }];

  function wire(opts: { plans?: unknown[]; exerciseError?: { message: string } | null } = {}) {
    const plansQuery = createMockQuery({ data: opts.plans ?? EARLIER, error: null });
    const sessionInsertQuery = makeSessionInsertQuery(["ts-1", "ts-2", "ts-3", "ts-rest"]);
    const exerciseInsertQuery = createMockQuery({ data: null, error: opts.exerciseError ?? null });
    const eventUpsertQuery = createMockQuery({ data: [], error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "training_plans") return plansQuery as never;
      if (table === "training_sessions") return sessionInsertQuery as never;
      if (table === "training_exercises") return exerciseInsertQuery as never;
      if (table === "training_events") return eventUpsertQuery as never;
      return createMockQuery({ data: null, error: null }) as never;
    });
    return { plansQuery, eventUpsertQuery };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetNextPlanStartCap.mockResolvedValue(null);
    mockGetBlockBound.mockResolvedValue(null);
    mockGetSavedPlanById.mockResolvedValue(makeSavedPlan());
    mockCreateAtomic.mockResolvedValue("new-plan-id");
    vi.mocked(cancelFutureEventsForPlans).mockResolvedValue([]);
  });

  it("cancels the earlier programs' forward rays from the start day AFTER the events land", async () => {
    const { plansQuery, eventUpsertQuery } = wire();

    await placePlanOnCalendar({
      savedPlanId: "sp-1", coachId: "coach-1", clientId: "client-1", startDate: "2026-04-15",
    });

    // The snapshot read: every live program starting on or before the start.
    expect(plansQuery.lte).toHaveBeenCalledWith("effective_from", "2026-04-15");
    expect(plansQuery.neq).toHaveBeenCalledWith("status", "archived");
    expect(cancelFutureEventsForPlans).toHaveBeenCalledWith(["old-1"], "2026-04-15");
    // Post-commit: the walk's upsert has already run.
    expect(vi.mocked(cancelFutureEventsForPlans).mock.invocationCallOrder[0]).toBeGreaterThan(
      eventUpsertQuery.upsert.mock.invocationCallOrder[0],
    );
    // Nothing was rolled back.
    expect(plansQuery.delete).not.toHaveBeenCalled();
  });

  it("a supersede failure is reported as such and never rolls the placement back", async () => {
    const { plansQuery, eventUpsertQuery } = wire();
    vi.mocked(cancelFutureEventsForPlans).mockRejectedValue(new Error("boom"));

    await expect(
      placePlanOnCalendar({
        savedPlanId: "sp-1", coachId: "coach-1", clientId: "client-1", startDate: "2026-04-15",
      }),
    ).rejects.toBeInstanceOf(PlacementSupersedeError);

    // No compensation: the new plan and its events stay, and the earlier
    // programs' rows keep the cap the RPC gave them — the only training_plans
    // update is the placement's own pass-length write.
    expect(plansQuery.delete).not.toHaveBeenCalled();
    expect(plansQuery.update).not.toHaveBeenCalledWith({ effective_until: "2026-06-30", status: "active" });
    expect(eventUpsertQuery.delete).not.toHaveBeenCalled();
  });

  it("a failed clone puts the earlier programs' windows and statuses back exactly", async () => {
    const { plansQuery } = wire({ exerciseError: { message: "disk full" } });

    await expect(
      placePlanOnCalendar({
        savedPlanId: "sp-1", coachId: "coach-1", clientId: "client-1", startDate: "2026-04-15",
      }),
    ).rejects.toThrow("Failed to clone exercises: Failed to insert exercises: disk full");

    // The RPC capped old-1 at 2026-04-14 (and would have archived a same-day
    // one); with the new plan gone, each row gets its snapshot back.
    expect(plansQuery.update).toHaveBeenCalledWith({ effective_until: "2026-06-30", status: "active" });
    expect(plansQuery.eq).toHaveBeenCalledWith("id", "old-1");
    // And the supersede never ran.
    expect(cancelFutureEventsForPlans).not.toHaveBeenCalled();
  });
});
