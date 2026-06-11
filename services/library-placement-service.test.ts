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
  deleteFutureEventsForPlan: vi.fn(),
}));

vi.mock("./training-event-calendar-service", () => ({
  validatePhaseBounds: vi.fn(),
}));

import { supabaseAdmin } from "./supabase-admin";
import { getSavedPlanById } from "./coach-saved-plan-service";
import { createTrainingPlanAtomic } from "./training-service";
import { deleteFutureEventsForPlan } from "./training-event-service";
import { validatePhaseBounds } from "./training-event-calendar-service";
import { placePlanOnCalendar, placeSessionOnCalendar } from "./library-placement-service";

const mockFrom = vi.mocked(supabaseAdmin.from);
const mockGetSavedPlanById = vi.mocked(getSavedPlanById);
const mockCreateAtomic = vi.mocked(createTrainingPlanAtomic);
const mockDeleteFuture = vi.mocked(deleteFutureEventsForPlan);
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
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
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

// Placement queries training_plans twice (active + planned) via Promise.all.
// This helper returns a fresh builder per from() call so concurrent chains
// don't share the status filter. Each builder resolves based on the status
// eq() it was asked to match.
function makeTrainingPlansFactory(config: {
  active?: { id: string } | null;
  planned?: { id: string } | null;
}) {
  const rows = {
    active: config.active ?? null,
    planned: config.planned ?? null,
  };
  return () => {
    let statusFilter: string | null = null;
    const builder: any = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockReturnThis(),
      eq: vi.fn().mockImplementation((column: string, value: string) => {
        if (column === "status") statusFilter = value;
        return builder;
      }),
      neq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockImplementation(() => {
        const row =
          statusFilter === "active"
            ? rows.active
            : statusFilter === "planned"
            ? rows.planned
            : null;
        return Promise.resolve({ data: row, error: null });
      }),
    };
    return builder;
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
    cycleLength: 4,
    restPattern: [3],
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
    mockDeleteFuture.mockResolvedValue();
    mockValidatePhaseBounds.mockResolvedValue();
  });

  // =========================================================================
  // placePlanOnCalendar
  // =========================================================================

  describe("placePlanOnCalendar", () => {
    it("rejects draft plans", async () => {
      mockGetSavedPlanById.mockResolvedValue(makeSavedPlan({ status: "draft" }));

      await expect(
        placePlanOnCalendar({
          savedPlanId: "sp-1",
          coachId: "coach-1",
          clientId: "client-1",
          startDate: "2026-04-15",
          clientToday: "2026-04-10",
        })
      ).rejects.toThrow("Only saved plans can be placed on calendar");
    });

    it("rejects when plan not found", async () => {
      mockGetSavedPlanById.mockResolvedValue(null);

      await expect(
        placePlanOnCalendar({
          savedPlanId: "sp-1",
          coachId: "coach-1",
          clientId: "client-1",
          startDate: "2026-04-15",
          clientToday: "2026-04-10",
        })
      ).rejects.toThrow("Saved plan not found");
    });

    it("creates plan, clones non-rest sessions and exercises, generates cycle-aware events", async () => {
      const savedPlan = makeSavedPlan();
      mockGetSavedPlanById.mockResolvedValue(savedPlan);
      mockCreateAtomic.mockResolvedValue("new-plan-id");

      // Mock: no existing active plan
      const noActivePlanQuery = createMockQuery({ data: null, error: null });
      // Mock: session insert (3 sessions)
      const sessionInsertQuery = createMockQuery({ data: { id: "ts-1" }, error: null });
      // Mock: exercise insert
      const exerciseInsertQuery = createMockQuery({ data: null, error: null });
      // Mock: phase query for end date calculation (no phase)
      const phaseQuery = createMockQuery({ data: null, error: null });
      // Mock: event upsert
      const eventUpsertQuery = createMockQuery({ data: [], error: null });

      let callCount = 0;
      mockFrom.mockImplementation((table: string) => {
        if (table === "training_plans") return noActivePlanQuery as any;
        if (table === "training_sessions") return sessionInsertQuery as any;
        if (table === "training_exercises") return exerciseInsertQuery as any;
        if (table === "phases") return phaseQuery as any;
        if (table === "training_events") return eventUpsertQuery as any;
        callCount++;
        return createMockQuery({ data: null, error: null }) as any;
      });

      const result = await placePlanOnCalendar({
        savedPlanId: "sp-1",
        coachId: "coach-1",
        clientId: "client-1",
        startDate: "2026-04-15",
        clientToday: "2026-04-10",
      });

      // Verify atomic plan creation was called
      expect(mockCreateAtomic).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: "client-1",
          coachId: "coach-1",
          name: "PPL Program",
          savedPlanId: "sp-1",
          effectiveFrom: "2026-04-15",
        })
      );

      // Verify 3 sessions inserted (rest session excluded)
      expect(result.sessionsCreated).toBe(3);

      // Verify session inserts used day_of_week = null
      expect(sessionInsertQuery.insert).toHaveBeenCalledTimes(3);
      for (const call of sessionInsertQuery.insert.mock.calls) {
        expect(call[0].day_of_week).toBeNull();
      }

      // Verify exercise inserts happened (3 sessions x 1 exercise each)
      expect(exerciseInsertQuery.insert).toHaveBeenCalledTimes(3);

      // Verify events were upserted
      expect(eventUpsertQuery.upsert).toHaveBeenCalledTimes(1);
      const events = eventUpsertQuery.upsert.mock.calls[0][0];

      // 8 weeks fallback = 56 days. With 4-day cycle and 1 rest day per cycle,
      // we get 3 training days per 4-day cycle = 14 cycles * 3 = 42 events
      expect(events.length).toBeGreaterThan(0);

      // All events should have is_modified = false
      for (const event of events) {
        expect(event.is_modified).toBe(false);
        expect(event.status).toBe("scheduled");
      }

      expect(result.planId).toBe("new-plan-id");
      expect(result.eventsCreated).toBe(events.length);
    });

    it("copies calorie_surplus_percentage from saved session, falling back to plan default", async () => {
      const savedPlan = makeSavedPlan({
        defaultSurplusPercentage: 10,
        sessions: [
          makeSession({ id: "ss-1", orderIndex: 0, calorieSurplusPercentage: 20 }),
          makeSession({ id: "ss-2", orderIndex: 1, calorieSurplusPercentage: null }),
        ],
        cycleLength: 2,
        restPattern: [],
      });
      mockGetSavedPlanById.mockResolvedValue(savedPlan);
      mockCreateAtomic.mockResolvedValue("new-plan-id");

      const noActivePlanQuery = createMockQuery({ data: null, error: null });
      const sessionInsertQuery = createMockQuery({ data: { id: "ts-1" }, error: null });
      const exerciseInsertQuery = createMockQuery({ data: null, error: null });
      const phaseQuery = createMockQuery({ data: null, error: null });
      const eventUpsertQuery = createMockQuery({ data: [], error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === "training_plans") return noActivePlanQuery as any;
        if (table === "training_sessions") return sessionInsertQuery as any;
        if (table === "training_exercises") return exerciseInsertQuery as any;
        if (table === "phases") return phaseQuery as any;
        if (table === "training_events") return eventUpsertQuery as any;
        return createMockQuery({ data: null, error: null }) as any;
      });

      await placePlanOnCalendar({
        savedPlanId: "sp-1",
        coachId: "coach-1",
        clientId: "client-1",
        startDate: "2026-04-15",
        clientToday: "2026-04-10",
      });

      // First session: explicit 20%
      expect(sessionInsertQuery.insert.mock.calls[0][0].calorie_surplus_percentage).toBe(20);
      // Second session: falls back to plan default 10%
      expect(sessionInsertQuery.insert.mock.calls[1][0].calorie_surplus_percentage).toBe(10);
    });

    it("deletes future events for old active plan", async () => {
      mockGetSavedPlanById.mockResolvedValue(makeSavedPlan({ sessions: [], cycleLength: 1, restPattern: [] }));
      mockCreateAtomic.mockResolvedValue("new-plan-id");

      const plansFactory = makeTrainingPlansFactory({
        active: { id: "old-active-id" },
        planned: null,
      });
      const phaseQuery = createMockQuery({ data: null, error: null });
      const eventUpsertQuery = createMockQuery({ data: [], error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === "training_plans") return plansFactory();
        if (table === "phases") return phaseQuery as any;
        if (table === "training_events") return eventUpsertQuery as any;
        return createMockQuery({ data: null, error: null }) as any;
      });

      await placePlanOnCalendar({
        savedPlanId: "sp-1",
        coachId: "coach-1",
        clientId: "client-1",
        startDate: "2026-04-15",
        clientToday: "2026-04-10",
      });

      expect(mockDeleteFuture).toHaveBeenCalledWith("old-active-id", "2026-04-15");
      // No planned plan existed, so only the active-cleanup call should have fired.
      expect(mockDeleteFuture).toHaveBeenCalledTimes(1);
    });

    it("deletes events for an existing planned plan so back-to-back future-dated placements don't leave orphans", async () => {
      // Coach has plan A planned for a future date, then applies plan B
      // (also planned). The RPC silently archives plan A — placement must
      // delete plan A's future events or the calendar double-books.
      mockGetSavedPlanById.mockResolvedValue(
        makeSavedPlan({ sessions: [], cycleLength: 1, restPattern: [] }),
      );
      mockCreateAtomic.mockResolvedValue("new-plan-b-id");

      const plansFactory = makeTrainingPlansFactory({
        active: null,
        planned: { id: "old-planned-id" },
      });
      const phaseQuery = createMockQuery({ data: null, error: null });
      const eventUpsertQuery = createMockQuery({ data: [], error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === "training_plans") return plansFactory();
        if (table === "phases") return phaseQuery as any;
        if (table === "training_events") return eventUpsertQuery as any;
        return createMockQuery({ data: null, error: null }) as any;
      });

      await placePlanOnCalendar({
        savedPlanId: "sp-1",
        coachId: "coach-1",
        clientId: "client-1",
        startDate: "2026-04-15",
        clientToday: "2026-04-10",
      });

      // Planned-plan cleanup anchors at client-local today, NOT startDate: the
      // RPC's STEP 0 already cleared >= startDate, so a startDate anchor would
      // no-op and orphan plan A's events in [A.start, B.start). The distinct
      // clientToday fixture ("2026-04-10" vs startDate "2026-04-15") makes this
      // assertion discriminate the two anchors.
      expect(mockDeleteFuture).toHaveBeenCalledWith("old-planned-id", "2026-04-10");
      // No active plan existed, so only the planned-cleanup call should have fired.
      expect(mockDeleteFuture).toHaveBeenCalledTimes(1);
    });

    it("preserves exercise_id FK from saved exercises", async () => {
      const savedPlan = makeSavedPlan({
        sessions: [
          makeSession({
            id: "ss-1",
            orderIndex: 0,
            exercises: [
              makeExercise({ exerciseId: "catalog-abc", name: "Bench Press" }),
              makeExercise({ id: "ex-2", exerciseId: null, name: "Custom Move" }),
            ],
          }),
        ],
        cycleLength: 1,
        restPattern: [],
      });
      mockGetSavedPlanById.mockResolvedValue(savedPlan);
      mockCreateAtomic.mockResolvedValue("new-plan-id");

      const noActivePlanQuery = createMockQuery({ data: null, error: null });
      const sessionInsertQuery = createMockQuery({ data: { id: "ts-1" }, error: null });
      const exerciseInsertQuery = createMockQuery({ data: null, error: null });
      const phaseQuery = createMockQuery({ data: null, error: null });
      const eventUpsertQuery = createMockQuery({ data: [], error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === "training_plans") return noActivePlanQuery as any;
        if (table === "training_sessions") return sessionInsertQuery as any;
        if (table === "training_exercises") return exerciseInsertQuery as any;
        if (table === "phases") return phaseQuery as any;
        if (table === "training_events") return eventUpsertQuery as any;
        return createMockQuery({ data: null, error: null }) as any;
      });

      await placePlanOnCalendar({
        savedPlanId: "sp-1",
        coachId: "coach-1",
        clientId: "client-1",
        startDate: "2026-04-15",
        clientToday: "2026-04-10",
      });

      const exerciseCall = exerciseInsertQuery.insert.mock.calls[0][0];
      expect(exerciseCall[0].exercise_id).toBe("catalog-abc");
      expect(exerciseCall[1].exercise_id).toBeNull();
    });
  });

  // =========================================================================
  // generateCycleAwareEvents (tested via placePlanOnCalendar)
  // =========================================================================

  describe("cycle-aware event generation", () => {
    it("4-day cycle with rest on day 3 generates correct pattern", async () => {
      // PPL + Rest: Push(0), Pull(1), Legs(2), Rest(3), Push(4=0), ...
      const savedPlan = makeSavedPlan({
        cycleLength: 4,
        restPattern: [3],
        programDurationWeeks: 1, // 7 days
        sessions: [
          makeSession({ id: "ss-push", name: "Push", orderIndex: 0, exercises: [] }),
          makeSession({ id: "ss-pull", name: "Pull", orderIndex: 1, exercises: [] }),
          makeSession({ id: "ss-legs", name: "Legs", orderIndex: 2, exercises: [] }),
          makeSession({ id: "ss-rest", name: "Rest", orderIndex: 3, isRest: true, exercises: [] }),
        ],
      });
      mockGetSavedPlanById.mockResolvedValue(savedPlan);
      mockCreateAtomic.mockResolvedValue("new-plan-id");

      const noActivePlanQuery = createMockQuery({ data: null, error: null });
      const sessionInsertQuery = createMockQuery({ data: { id: "ts-x" }, error: null });
      // Need to return different IDs for each session insert
      let sessionCallIdx = 0;
      const sessionIds = ["ts-push", "ts-pull", "ts-legs"];
      const sessionInsertQueryDynamic = {
        ...createMockQuery({ data: null, error: null }),
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockImplementation(() =>
          Promise.resolve({ data: { id: sessionIds[sessionCallIdx++] }, error: null })
        ),
      };
      const eventUpsertQuery = createMockQuery({ data: [], error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === "training_plans") return noActivePlanQuery as any;
        if (table === "training_sessions") return sessionInsertQueryDynamic as any;
        if (table === "training_events") return eventUpsertQuery as any;
        return createMockQuery({ data: null, error: null }) as any;
      });

      await placePlanOnCalendar({
        savedPlanId: "sp-1",
        coachId: "coach-1",
        clientId: "client-1",
        startDate: "2026-04-15",
        clientToday: "2026-04-10",
      });

      const events = eventUpsertQuery.upsert.mock.calls[0][0];

      // 7 days, 4-day cycle with 1 rest = 3 training days per cycle
      // Day 0 (Apr 15): Push, Day 1 (Apr 16): Pull, Day 2 (Apr 17): Legs
      // Day 3 (Apr 18): REST
      // Day 4 (Apr 19) = cycle pos 0: Push, Day 5 (Apr 20) = pos 1: Pull
      // Day 6 (Apr 21) = pos 2: Legs
      // = 6 events total (last cycle incomplete but no rest day reached)

      // Verify rest day skipped (April 18 should not have an event)
      const dates = events.map((e: { date: string }) => e.date);
      expect(dates).not.toContain("2026-04-18");
      expect(dates).toContain("2026-04-15");
      expect(dates).toContain("2026-04-16");
      expect(dates).toContain("2026-04-17");
      expect(dates).toContain("2026-04-19");
      expect(events.length).toBe(6);
    });

    it("3-day cycle with no rest fills every day", async () => {
      const savedPlan = makeSavedPlan({
        cycleLength: 3,
        restPattern: [],
        programDurationWeeks: 1,
        sessions: [
          makeSession({ id: "ss-a", name: "A", orderIndex: 0, exercises: [] }),
          makeSession({ id: "ss-b", name: "B", orderIndex: 1, exercises: [] }),
          makeSession({ id: "ss-c", name: "C", orderIndex: 2, exercises: [] }),
        ],
      });
      mockGetSavedPlanById.mockResolvedValue(savedPlan);
      mockCreateAtomic.mockResolvedValue("new-plan-id");

      const noActivePlanQuery = createMockQuery({ data: null, error: null });
      let idx = 0;
      const sIds = ["ts-a", "ts-b", "ts-c"];
      const sessionQuery = {
        ...createMockQuery({ data: null, error: null }),
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockImplementation(() =>
          Promise.resolve({ data: { id: sIds[idx++] }, error: null })
        ),
      };
      const eventQuery = createMockQuery({ data: [], error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === "training_plans") return noActivePlanQuery as any;
        if (table === "training_sessions") return sessionQuery as any;
        if (table === "training_events") return eventQuery as any;
        return createMockQuery({ data: null, error: null }) as any;
      });

      await placePlanOnCalendar({
        savedPlanId: "sp-1",
        coachId: "coach-1",
        clientId: "client-1",
        startDate: "2026-04-15",
        clientToday: "2026-04-10",
      });

      const events = eventQuery.upsert.mock.calls[0][0];
      // 7 days, no rest = 7 events
      expect(events.length).toBe(7);
    });
  });

  // =========================================================================
  // placeSessionOnCalendar
  // =========================================================================

  describe("placeSessionOnCalendar", () => {
    it("creates session, exercises, and event with is_modified = true", async () => {
      const savedSessionRow = {
        id: "ss-1",
        coach_id: "coach-1",
        saved_plan_id: null,
        name: "Push Day",
        focus: "chest",
        order_index: 0,
        is_rest: false,
        estimated_duration_minutes: 60,
        calorie_surplus_percentage: 15,
        notes: null,
        session_type: "training",
        coach_saved_exercises: [
          {
            id: "se-1",
            exercise_id: "catalog-1",
            name: "Bench Press",
            order_index: 0,
            sets: 4,
            reps_min: 8,
            reps_max: 12,
            reps_target: null,
            rpe_target: 8,
            percentage_1rm: null,
            tempo: null,
            rest_seconds: 90,
            notes: null,
            superset_group: null,
            is_warmup: false,
          },
        ],
      };

      const sessionFetchQuery = createMockQuery({ data: savedSessionRow, error: null });
      const sessionInsertQuery = createMockQuery({ data: { id: "ts-new" }, error: null });
      const exerciseInsertQuery = createMockQuery({ data: null, error: null });
      const eventInsertQuery = createMockQuery({ data: { id: "evt-new" }, error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === "coach_saved_sessions") return sessionFetchQuery as any;
        if (table === "training_sessions") return sessionInsertQuery as any;
        if (table === "training_exercises") return exerciseInsertQuery as any;
        if (table === "training_events") return eventInsertQuery as any;
        return createMockQuery({ data: null, error: null }) as any;
      });

      const result = await placeSessionOnCalendar({
        savedSessionId: "ss-1",
        coachId: "coach-1",
        clientId: "client-1",
        planId: "plan-1",
        targetDate: "2026-04-20",
      });

      expect(result.sessionId).toBe("ts-new");
      expect(result.eventId).toBe("evt-new");

      // Verify session insert
      expect(sessionInsertQuery.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          plan_id: "plan-1",
          day_of_week: null,
          calorie_surplus_percentage: 15,
        })
      );

      // Verify exercise insert preserves exercise_id
      const exInsert = exerciseInsertQuery.insert.mock.calls[0][0];
      expect(exInsert[0].exercise_id).toBe("catalog-1");

      // Verify event has is_modified = true
      expect(eventInsertQuery.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          is_modified: true,
          date: "2026-04-20",
          status: "scheduled",
          calorie_surplus_percentage: 15,
        })
      );

      // Verify phase bounds checked
      expect(mockValidatePhaseBounds).toHaveBeenCalledWith("plan-1", "2026-04-20");
    });

    it("rejects when phase boundary is violated", async () => {
      mockValidatePhaseBounds.mockRejectedValue(
        new Error("Target date is outside the current phase")
      );

      // Still need the session fetch to succeed for the function to reach validation
      const sessionFetchQuery = createMockQuery({
        data: { id: "ss-1", coach_id: "coach-1", name: "Push", focus: null, order_index: 0, is_rest: false, estimated_duration_minutes: 60, calorie_surplus_percentage: null, notes: null, session_type: "training", coach_saved_exercises: [] },
        error: null,
      });
      mockFrom.mockImplementation((table: string) => {
        if (table === "coach_saved_sessions") return sessionFetchQuery as any;
        return createMockQuery({ data: null, error: null }) as any;
      });

      await expect(
        placeSessionOnCalendar({
          savedSessionId: "ss-1",
          coachId: "coach-1",
          clientId: "client-1",
          planId: "plan-1",
          targetDate: "2026-06-01",
        })
      ).rejects.toThrow("outside the current phase");
    });
  });
});
