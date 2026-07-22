import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SavedPlan, SavedSession, SavedExercise } from "@/types/training";

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
}));

vi.mock("./training-event-calendar-service", () => ({
  validatePhaseBounds: vi.fn(),
}));

import { supabaseAdmin } from "./supabase-admin";
import { getSavedPlanById } from "./coach-saved-plan-service";
import { createTrainingPlanAtomic } from "./training-service";
import { getNextPlanStartCap } from "./training-event-service";
import { validatePhaseBounds } from "./training-event-calendar-service";
import {
  placePlanOnCalendar,
  placeSessionOnCalendar,
  placeInlineEditedPlanOnCalendar,
} from "./library-placement-service";
import { deriveFrequencyPerWeek } from "./coach-library-helpers";
import type { InlinePlanBody } from "@/lib/validations/training";

const mockFrom = vi.mocked(supabaseAdmin.from);
const mockGetSavedPlanById = vi.mocked(getSavedPlanById);
const mockCreateAtomic = vi.mocked(createTrainingPlanAtomic);
const mockGetNextPlanStartCap = vi.mocked(getNextPlanStartCap);
const mockValidatePhaseBounds = vi.mocked(validatePhaseBounds);

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

// A training_sessions insert mock that hands out a distinct cloned id per slot,
// so multi-session / multi-week placements reference distinct sessions.
function makeSessionInsertQuery(ids: string[]) {
  let i = 0;
  return {
    ...createMockQuery({ data: null, error: null }),
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockImplementation(() =>
      Promise.resolve({ data: { id: ids[i++] ?? `ts-${i}` }, error: null }),
    ),
  };
}

// --- Test data factories ---

function makeExercise(overrides?: Partial<SavedExercise>): SavedExercise {
  return {
    id: "ex-1",
    savedSessionId: "ss-1",
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
    supersetGroup: null,
    isWarmup: false,
    notes: null,
    setSpecs: null,
    videoUrl: null,
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
    exercises: [makeExercise()],
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
      makeSession({ id: "ss-rest", name: "Rest", orderIndex: 3, isRest: true, exercises: [] }),
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
    mockValidatePhaseBounds.mockResolvedValue();
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
      const exerciseInsertQuery = createMockQuery({ data: null, error: null });
      const eventUpsertQuery = createMockQuery({ data: [], error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === "training_sessions") return sessionInsertQuery as never;
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
      expect(sessionInsertQuery.insert).toHaveBeenCalledTimes(4);
      expect(result.sessionsCreated).toBe(3);
      for (const call of sessionInsertQuery.insert.mock.calls) {
        expect(call[0].day_of_week).toBeNull();
      }
      const restInsert = sessionInsertQuery.insert.mock.calls.find((c) => c[0].is_rest === true);
      expect(restInsert).toBeDefined();
      expect(restInsert![0].name).toBe("Rest");
      expect(sessionInsertQuery.insert.mock.calls.filter((c) => c[0].is_rest === false)).toHaveLength(3);
      // Only the 3 non-rest slots get exercises.
      expect(exerciseInsertQuery.insert).toHaveBeenCalledTimes(3);
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
            makeSession({ id: "a", name: "A", orderIndex: 0, exercises: [] }),
            makeSession({ id: "b", name: "B", orderIndex: 1, exercises: [] }),
            makeSession({ id: "c", name: "C", orderIndex: 2, exercises: [] }),
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
            makeSession({ id: "ss-1", orderIndex: 0, calorieSurplusPercentage: 20, exercises: [] }),
            makeSession({ id: "ss-2", orderIndex: 1, calorieSurplusPercentage: null, exercises: [] }),
            makeSession({ id: "ss-r", orderIndex: 2, isRest: true, calorieSurplusPercentage: 99, exercises: [] }),
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

      expect(sessionInsertQuery.insert.mock.calls[0][0].calorie_surplus_percentage).toBe(20);
      expect(sessionInsertQuery.insert.mock.calls[1][0].calorie_surplus_percentage).toBe(10);
      // Rest slot surplus is nulled regardless of the source value.
      expect(sessionInsertQuery.insert.mock.calls[2][0].calorie_surplus_percentage).toBeNull();
    });

    it("passes effectiveFrom + windowEnd to the atomic RPC, capped at the next plan's start", async () => {
      // A 28-slot (4-week) program would run to 2026-05-12, but a later plan
      // starts 2026-05-01 so getNextPlanStartCap caps the window at 2026-04-30.
      mockGetSavedPlanById.mockResolvedValue(
        makeSavedPlan({
          sessions: Array.from({ length: 28 }, (_, i) =>
            makeSession({ id: `d-${i}`, weekIndex: Math.floor(i / 7), orderIndex: i % 7, exercises: [] }),
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
        sessions: [makeSession({ id: "ss-1", orderIndex: 0, calorieSurplusPercentage: 15, exercises: [] })],
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
            makeSession({ id: "ss-1", orderIndex: 0, calorieSurplusPercentage: 25, exercises: [] }),
            makeSession({ id: "ss-2", orderIndex: 1, calorieSurplusPercentage: 25, exercises: [] }),
            makeSession({ id: "ss-3", orderIndex: 2, calorieSurplusPercentage: 25, exercises: [] }),
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
              exercises: [
                makeExercise({ exerciseId: "catalog-abc", name: "Bench Press" }),
                makeExercise({ id: "ex-2", exerciseId: null, name: "Custom Move" }),
              ],
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
              exercises: [makeExercise({ setSpecs: specs as never, videoUrl: "https://demo/bench" })],
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
            makeSession({ id: "ss-push", name: "Push", orderIndex: 0, exercises: [] }),
            makeSession({ id: "ss-pull", name: "Pull", orderIndex: 1, exercises: [] }),
            makeSession({ id: "ss-legs", name: "Legs", orderIndex: 2, exercises: [] }),
            makeSession({ id: "ss-rest", name: "Rest", orderIndex: 3, isRest: true, exercises: [] }),
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
            makeSession({ id: "ss-w0", name: "Workout", orderIndex: 0, exercises: [] }),
            makeSession({ id: "ss-r1", name: "Rest", orderIndex: 1, isRest: true, exercises: [] }),
            makeSession({ id: "ss-w2", name: "Workout", orderIndex: 2, exercises: [] }),
            makeSession({ id: "ss-r3", name: "Rest", orderIndex: 3, isRest: true, exercises: [] }),
            makeSession({ id: "ss-w4", name: "Workout", orderIndex: 4, exercises: [] }),
            makeSession({ id: "ss-r5", name: "Rest", orderIndex: 5, isRest: true, exercises: [] }),
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
            makeSession({ id: "a", name: "A", weekIndex: 0, orderIndex: 0, exercises: [] }),
            makeSession({ id: "b", name: "B", weekIndex: 0, orderIndex: 1, exercises: [] }),
            makeSession({ id: "c", name: "C", weekIndex: 1, orderIndex: 0, exercises: [] }),
            makeSession({ id: "d", name: "D", weekIndex: 1, orderIndex: 1, exercises: [] }),
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
      expect(sessionInsertQuery.insert.mock.calls.map((c) => c[0].name)).toEqual(["A", "B", "C", "D"]);
      expect(sessionInsertQuery.insert.mock.calls.map((c) => c[0].week_index)).toEqual([0, 0, 1, 1]);
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
            makeSession({ id: "a", name: "A", weekIndex: 0, orderIndex: 0, exercises: [] }),
            makeSession({ id: "b", name: "B", weekIndex: 0, orderIndex: 1, exercises: [] }),
            makeSession({ id: "r1", name: "Rest", weekIndex: 1, orderIndex: 0, isRest: true, exercises: [] }),
            makeSession({ id: "r2", name: "Rest", weekIndex: 1, orderIndex: 1, isRest: true, exercises: [] }),
            makeSession({ id: "c", name: "C", weekIndex: 2, orderIndex: 0, exercises: [] }),
            makeSession({ id: "r3", name: "Rest", weekIndex: 2, orderIndex: 1, isRest: true, exercises: [] }),
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
        coach_saved_exercises: [
          {
            id: "se-1", exercise_id: "catalog-1", name: "Bench Press", order_index: 0, sets: 4,
            reps_min: 8, reps_max: 12, reps_target: null, rpe_target: 8, percentage_1rm: null,
            tempo: null, rest_seconds: 90, notes: null, superset_group: null, is_warmup: false,
            set_specs: null, video_url: null,
          },
        ],
      };
      const sessionFetchQuery = createMockQuery({ data: savedSessionRow, error: null });
      const sessionInsertQuery = createMockQuery({ data: { id: "ts-new" }, error: null });
      const exerciseInsertQuery = createMockQuery({ data: null, error: null });
      const eventInsertQuery = createMockQuery({ data: { id: "evt-new" }, error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === "coach_saved_sessions") return sessionFetchQuery as never;
        if (table === "training_sessions") return sessionInsertQuery as never;
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
      const exInsert = exerciseInsertQuery.insert.mock.calls[0][0];
      expect(exInsert[0].exercise_id).toBe("catalog-1");
      expect(eventInsertQuery.insert).toHaveBeenCalledWith(
        expect.objectContaining({ is_modified: true, date: "2026-04-20", status: "scheduled", calorie_surplus_percentage: 15 }),
      );
      expect(mockValidatePhaseBounds).toHaveBeenCalledWith("plan-1", "2026-04-20");
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
        session_type: "training", coach_saved_exercises: [],
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

    it("rejects when phase boundary is violated", async () => {
      mockValidatePhaseBounds.mockRejectedValue(new Error("Target date is outside the current phase"));
      const sessionFetchQuery = createMockQuery({
        data: { id: "ss-1", coach_id: "coach-1", name: "Push", focus: null, order_index: 0, week_index: 0, is_rest: false, estimated_duration_minutes: 60, calorie_surplus_percentage: null, notes: null, session_type: "training", coach_saved_exercises: [] },
        error: null,
      });
      mockFrom.mockImplementation((table: string) => {
        if (table === "coach_saved_sessions") return sessionFetchQuery as never;
        return createMockQuery({ data: null, error: null }) as never;
      });

      await expect(
        placeSessionOnCalendar({ savedSessionId: "ss-1", coachId: "coach-1", clientId: "client-1", planId: "plan-1", targetDate: "2026-06-01" }),
      ).rejects.toThrow("outside the current phase");
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
            exercises: [{ name: "Bench", exerciseId: "catalog-1", orderIndex: 0, sets: 3 }],
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
      expect(sessionInsertQuery.insert).toHaveBeenCalledWith(
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
              exercises: [
                { name: "Owned", exerciseId: "catalog-1", orderIndex: 0, sets: 3 },
                { name: "Foreign", exerciseId: "not-in-catalog", orderIndex: 1, sets: 3 },
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
