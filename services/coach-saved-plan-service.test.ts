import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock supabase-admin before importing the service
vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

// Mock exercise catalog service
vi.mock("./exercise-catalog-service", () => ({
  resolveExercises: vi.fn(),
}));

// Inline query mock helper (same pattern as training-event-service.test.ts)
function createMockQuery<T = unknown>(result: { data: T | null; error: { message: string } | null }) {
  const mockQuery = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
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

import { supabaseAdmin } from "./supabase-admin";
import { resolveExercises } from "./exercise-catalog-service";
import {
  promoteDraftToSaved,
  getSavedPlans,
} from "./coach-saved-plan-service";

const mockFrom = vi.mocked(supabaseAdmin.from);
const mockResolveExercises = vi.mocked(resolveExercises);

describe("coach-saved-plan-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T12:00:00"));
    mockResolveExercises.mockResolvedValue(
      new Map([
        ["bench press", "ex-1"],
        ["squat", "ex-2"],
        ["deadlift", "ex-3"],
      ])
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // =========================================================================
  // =========================================================================

  // =========================================================================
  // promoteDraftToSaved
  // =========================================================================

  describe("promoteDraftToSaved", () => {
    it("updates status to saved", async () => {
      const planQuery = createMockQuery({
        data: { id: "plan-1", name: "My Plan", coach_id: "coach-1", status: "draft" },
        error: null,
      });
      const conflictQuery = createMockQuery({ data: null, error: null });
      const updateQuery = createMockQuery({ data: null, error: null });

      let callCount = 0;
      mockFrom.mockImplementation((table: string) => {
        if (table === "coach_saved_plans") {
          callCount++;
          if (callCount === 1) return planQuery as any; // fetch plan
          if (callCount === 2) return conflictQuery as any; // conflict check
          return updateQuery as any; // update status
        }
        return createMockQuery({ data: null, error: null }) as any;
      });

      const result = await promoteDraftToSaved("plan-1", "coach-1", {
        saveSessionsIndividually: false,
      });

      expect(result).toEqual({});
      expect(updateQuery.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: "saved" })
      );
    });

    it("returns nameConflict if plan name already exists for this coach", async () => {
      const planQuery = createMockQuery({
        data: { id: "plan-1", name: "My Plan", coach_id: "coach-1", status: "draft" },
        error: null,
      });
      const conflictQuery = createMockQuery({
        data: { id: "existing-plan" },
        error: null,
      });

      let callCount = 0;
      mockFrom.mockImplementation((table: string) => {
        if (table === "coach_saved_plans") {
          callCount++;
          if (callCount === 1) return planQuery as any;
          return conflictQuery as any;
        }
        return createMockQuery({ data: null, error: null }) as any;
      });

      const result = await promoteDraftToSaved("plan-1", "coach-1", {
        saveSessionsIndividually: false,
      });

      expect(result.nameConflict).toBeTruthy();
    });

    it("creates standalone copies when saveSessionsIndividually is true", async () => {
      const planQuery = createMockQuery({
        data: { id: "plan-1", name: "My Plan", coach_id: "coach-1", status: "draft" },
        error: null,
      });
      const conflictQuery = createMockQuery({ data: null, error: null });
      const updateQuery = createMockQuery({ data: null, error: null });

      const sessionData = [
        {
          id: "s1",
          coach_id: "coach-1",
          saved_plan_id: "plan-1",
          name: "Push",
          focus: "chest",
          order_index: 0,
          is_rest: false,
          estimated_duration_minutes: 60,
          calorie_surplus_percentage: null,
          notes: null,
          session_type: "training",
          coach_saved_exercises: [
            {
              id: "e1",
              saved_session_id: "s1",
              exercise_id: "ex-1",
              name: "Bench Press",
              order_index: 0,
              sets: 3,
              reps_min: null,
              reps_max: null,
              reps_target: "8-10",
              rpe_target: null,
              percentage_1rm: null,
              tempo: null,
              rest_seconds: 90,
              superset_group: null,
              is_warmup: false,
              notes: null,
              created_at: "2026-04-15T12:00:00Z",
              updated_at: "2026-04-15T12:00:00Z",
            },
          ],
          created_at: "2026-04-15T12:00:00Z",
          updated_at: "2026-04-15T12:00:00Z",
        },
      ];
      const sessionsQuery = createMockQuery({ data: sessionData, error: null });
      // Standalone exists check
      const standaloneCheckQuery = createMockQuery({ data: null, error: null });
      // Insert standalone session
      const standaloneInsertQuery = createMockQuery({ data: { id: "standalone-1" }, error: null });
      // Insert standalone exercises
      const exerciseInsertQuery = createMockQuery({ data: null, error: null });

      let planCallCount = 0;
      let sessionCallCount = 0;
      mockFrom.mockImplementation((table: string) => {
        if (table === "coach_saved_plans") {
          planCallCount++;
          if (planCallCount === 1) return planQuery as any;
          if (planCallCount === 2) return conflictQuery as any;
          return updateQuery as any;
        }
        if (table === "coach_saved_sessions") {
          sessionCallCount++;
          if (sessionCallCount === 1) return sessionsQuery as any; // fetch sessions
          if (sessionCallCount === 2) return standaloneCheckQuery as any; // dedup check
          return standaloneInsertQuery as any; // insert standalone
        }
        if (table === "coach_saved_exercises") return exerciseInsertQuery as any;
        return createMockQuery({ data: null, error: null }) as any;
      });

      // Override the sessions query to be iterable
      Object.defineProperty(sessionsQuery, "then", {
        value: (resolve: (value: { data: typeof sessionData; error: null }) => void) =>
          Promise.resolve({ data: sessionData, error: null }).then(resolve),
      });

      const result = await promoteDraftToSaved("plan-1", "coach-1", {
        saveSessionsIndividually: true,
      });

      expect(result).toEqual({});
      // Should have inserted the standalone session copy
      expect(standaloneInsertQuery.insert).toHaveBeenCalled();
    });

    it("skips standalone creation when saveSessionsIndividually is false", async () => {
      const planQuery = createMockQuery({
        data: { id: "plan-1", name: "My Plan", coach_id: "coach-1", status: "draft" },
        error: null,
      });
      const conflictQuery = createMockQuery({ data: null, error: null });
      const updateQuery = createMockQuery({ data: null, error: null });

      let callCount = 0;
      mockFrom.mockImplementation((table: string) => {
        if (table === "coach_saved_plans") {
          callCount++;
          if (callCount === 1) return planQuery as any;
          if (callCount === 2) return conflictQuery as any;
          return updateQuery as any;
        }
        return createMockQuery({ data: null, error: null }) as any;
      });

      await promoteDraftToSaved("plan-1", "coach-1", {
        saveSessionsIndividually: false,
      });

      // Should NOT query sessions for standalone creation
      const sessionCalls = mockFrom.mock.calls.filter(
        ([table]) => (table as string) === "coach_saved_sessions"
      );
      expect(sessionCalls).toHaveLength(0);
    });
  });

  // =========================================================================
  // getSavedPlans
  // =========================================================================

  describe("getSavedPlans", () => {
    it("filters to status = saved only by default (excludes drafts)", async () => {
      const plansQuery = createMockQuery({ data: [], error: null });
      mockFrom.mockReturnValue(plansQuery as any);

      await getSavedPlans("coach-1");

      expect(mockFrom).toHaveBeenCalledWith("coach_saved_plans");
      expect(plansQuery.eq).toHaveBeenCalledWith("coach_id", "coach-1");
      expect(plansQuery.in).toHaveBeenCalledWith("status", ["saved"]);
    });

    it("includes drafts when opted in (Programs table)", async () => {
      const plansQuery = createMockQuery({ data: [], error: null });
      mockFrom.mockReturnValue(plansQuery as any);

      await getSavedPlans("coach-1", { includeDrafts: true });

      expect(plansQuery.in).toHaveBeenCalledWith("status", ["saved", "draft"]);
    });

    it("returns nested sessions and exercises", async () => {
      const planData = [
        {
          id: "plan-1",
          coach_id: "coach-1",
          name: "PPL",
          description: null,
          split_type: "push_pull_legs",
          frequency_per_week: 3,
          status: "saved",
          default_surplus_percentage: 15,
          source: "ai",
          coach_prompt: null,
          program_duration_weeks: null,
          created_at: "2026-04-15T12:00:00Z",
          updated_at: "2026-04-15T12:00:00Z",
          coach_saved_sessions: [
            {
              id: "s1",
              coach_id: "coach-1",
              saved_plan_id: "plan-1",
              name: "Push",
              focus: "chest",
              order_index: 0,
              is_rest: false,
              estimated_duration_minutes: 60,
              calorie_surplus_percentage: null,
              notes: null,
              session_type: "training",
              created_at: "2026-04-15T12:00:00Z",
              updated_at: "2026-04-15T12:00:00Z",
              coach_saved_exercises: [
                {
                  id: "e1",
                  saved_session_id: "s1",
                  exercise_id: "ex-1",
                  name: "Bench Press",
                  order_index: 0,
                  sets: 3,
                  reps_min: null,
                  reps_max: null,
                  reps_target: "8-10",
                  rpe_target: null,
                  percentage_1rm: null,
                  tempo: null,
                  rest_seconds: 90,
                  superset_group: null,
                  is_warmup: false,
                  notes: null,
                  created_at: "2026-04-15T12:00:00Z",
                  updated_at: "2026-04-15T12:00:00Z",
                },
              ],
            },
          ],
        },
      ];

      const plansQuery = createMockQuery({ data: planData, error: null });

      // Override then to return the array format
      Object.defineProperty(plansQuery, "then", {
        value: (resolve: (value: { data: typeof planData; error: null }) => void) =>
          Promise.resolve({ data: planData, error: null }).then(resolve),
      });

      mockFrom.mockReturnValue(plansQuery as any);

      const plans = await getSavedPlans("coach-1");

      expect(plans).toHaveLength(1);
      expect(plans[0].name).toBe("PPL");
      expect(plans[0].sessions).toHaveLength(1);
      expect(plans[0].sessions[0].name).toBe("Push");
      expect(plans[0].sessions[0].exercises).toHaveLength(1);
      expect(plans[0].sessions[0].exercises[0].name).toBe("Bench Press");
    });
  });

});
