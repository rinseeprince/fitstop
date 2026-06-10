import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getPhaseReviewData,
  transitionPhase,
} from "./phase-transition-service";
import { createMockPhaseRow } from "@/__tests__/helpers/mock-data-builders";

vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock("./body-metrics-service", () => ({
  getBodyMetricsHistory: vi.fn(),
  getLatestBodyMetrics: vi.fn(),
}));

vi.mock("./client-goals-service", () => ({
  getCurrentGoals: vi.fn(),
}));

import { supabaseAdmin } from "./supabase-admin";
import { getBodyMetricsHistory, getLatestBodyMetrics } from "./body-metrics-service";
import { getCurrentGoals } from "./client-goals-service";

function createMockQuery(result: { data: unknown; error: unknown; count?: number }) {
  return {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: typeof result) => void) =>
      Promise.resolve(result).then(resolve),
    // Support head: true count queries
    count: result.count,
  };
}

const CLIENT_ID = "client-1";
const PHASE_ID = "phase-1";

describe("Phase Transition Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getPhaseReviewData", () => {
    const mockPhaseRow = createMockPhaseRow({
      id: PHASE_ID,
      clientId: CLIENT_ID,
      status: "active",
      startDate: "2026-01-01",
      endDate: "2026-03-01",
      roadmapId: "roadmap-1",
      phaseGoalsSnapshot: { goalWeight: 80 },
    });

    function setupPhaseQuery() {
      const phaseQuery = createMockQuery({ data: mockPhaseRow, error: null });
      const trainingQuery = createMockQuery({
        data: { frequency_per_week: 4 },
        error: null,
      });
      const sessionLogsQuery = createMockQuery({
        data: null,
        error: null,
        count: 28,
      });
      const nutritionLogsQuery = createMockQuery({
        data: [
          { nutrition_adherence: "hit" },
          { nutrition_adherence: "partial" },
          { nutrition_adherence: "missed" },
        ],
        error: null,
      });
      const habitsQuery = createMockQuery({
        data: [{ id: "habit-1" }, { id: "habit-2" }],
        error: null,
      });
      const habitLogsQuery = createMockQuery({
        data: null,
        error: null,
        count: 60,
      });
      const nextPhaseQuery = createMockQuery({
        data: { id: "phase-2", name: "Phase 2" },
        error: null,
      });

      // Mock by table name to avoid race conditions from Promise.allSettled
      let phasesCallCount = 0;
      vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
        if (table === "phases") {
          phasesCallCount++;
          // First call fetches the phase, second looks up next phase
          return phasesCallCount === 1
            ? phaseQuery
            : nextPhaseQuery;
        }
        if (table === "training_plans") return trainingQuery;
        if (table === "session_logs") return sessionLogsQuery;
        if (table === "nutrition_logs") return nutritionLogsQuery;
        if (table === "daily_habits") return habitsQuery;
        if (table === "daily_habit_logs") return habitLogsQuery;
        return createMockQuery({ data: null, error: null });
      }) as never);
    }

    it("returns metrics comparison and adherence stats with correct percentages", async () => {
      setupPhaseQuery();
      vi.mocked(getBodyMetricsHistory).mockResolvedValue([
        {
          id: "m1", clientId: CLIENT_ID, weight: 85,
          source: "check_in", recordedAt: "2026-01-01", createdAt: "2026-01-01",
        },
      ]);
      vi.mocked(getLatestBodyMetrics).mockResolvedValue({
        id: "m2", clientId: CLIENT_ID, weight: 82,
        source: "check_in", recordedAt: "2026-03-01", createdAt: "2026-03-01",
      });
      vi.mocked(getCurrentGoals).mockResolvedValue({
        id: "g1", clientId: CLIENT_ID, goalWeight: 80,
        setBy: "coach", effectiveFrom: "2026-01-01",
        createdAt: "2026-01-01", updatedAt: "2026-01-01",
      });

      const result = await getPhaseReviewData(PHASE_ID, CLIENT_ID);

      expect(result.phase.id).toBe(PHASE_ID);
      expect(result.bodyMetrics.start?.weight).toBe(85);
      expect(result.bodyMetrics.current?.weight).toBe(82);
      expect(result.trainingAdherence).not.toBeNull();
      expect(result.hasNextPhase).toBe(true);
      expect(result.nextPhaseName).toBe("Phase 2");
      expect(result.goalsAtStart).toEqual({ goalWeight: 80 });
    });

    it("handles phase with no body metrics gracefully", async () => {
      setupPhaseQuery();
      vi.mocked(getBodyMetricsHistory).mockResolvedValue([]);
      vi.mocked(getLatestBodyMetrics).mockResolvedValue(null);
      vi.mocked(getCurrentGoals).mockResolvedValue(null);

      const result = await getPhaseReviewData(PHASE_ID, CLIENT_ID);

      expect(result.bodyMetrics.start).toBeNull();
      expect(result.bodyMetrics.current).toBeNull();
    });

    it("handles phase with no linked training plan", async () => {
      const phaseQuery = createMockQuery({ data: mockPhaseRow, error: null });
      const noTrainingQuery = createMockQuery({ data: null, error: null });
      const sessionLogsQuery = createMockQuery({ data: null, error: null, count: 12 });
      const nutritionLogsQuery = createMockQuery({ data: [], error: null });
      const habitsQuery = createMockQuery({ data: [], error: null });
      const nextPhaseQuery = createMockQuery({ data: null, error: null });

      let phasesCallCount = 0;
      vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
        if (table === "phases") {
          phasesCallCount++;
          return phasesCallCount === 1 ? phaseQuery : nextPhaseQuery;
        }
        if (table === "training_plans") return noTrainingQuery;
        if (table === "session_logs") return sessionLogsQuery;
        if (table === "nutrition_logs") return nutritionLogsQuery;
        if (table === "daily_habits") return habitsQuery;
        return createMockQuery({ data: null, error: null });
      }) as never);

      vi.mocked(getBodyMetricsHistory).mockResolvedValue([]);
      vi.mocked(getLatestBodyMetrics).mockResolvedValue(null);
      vi.mocked(getCurrentGoals).mockResolvedValue(null);

      const result = await getPhaseReviewData(PHASE_ID, CLIENT_ID);

      // No training plan means completed count only, no percentage
      expect(result.trainingAdherence?.completed).toBe(12);
      expect(result.trainingAdherence?.percentage).toBeNull();
    });

    it("handles phase with no nutrition logs", async () => {
      const phaseQuery = createMockQuery({ data: mockPhaseRow, error: null });
      const trainingQuery = createMockQuery({
        data: { frequency_per_week: 3 },
        error: null,
      });
      const sessionLogsQuery = createMockQuery({
        data: null,
        error: null,
        count: 10,
      });
      const emptyNutritionQuery = createMockQuery({
        data: [],
        error: null,
      });
      const habitsQuery = createMockQuery({ data: [], error: null });
      const nextPhaseQuery = createMockQuery({ data: null, error: null });

      let phasesCallCount = 0;
      vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
        if (table === "phases") {
          phasesCallCount++;
          return phasesCallCount === 1 ? phaseQuery : nextPhaseQuery;
        }
        if (table === "training_plans") return trainingQuery;
        if (table === "session_logs") return sessionLogsQuery;
        if (table === "nutrition_logs") return emptyNutritionQuery;
        if (table === "daily_habits") return habitsQuery;
        return createMockQuery({ data: null, error: null });
      }) as never);

      vi.mocked(getBodyMetricsHistory).mockResolvedValue([]);
      vi.mocked(getLatestBodyMetrics).mockResolvedValue(null);
      vi.mocked(getCurrentGoals).mockResolvedValue(null);

      const result = await getPhaseReviewData(PHASE_ID, CLIENT_ID);

      expect(result.nutritionAdherence).toBeNull();
    });

    it("bounds an OPEN phase's adherence window at the supplied (coach-local) today", async () => {
      // endDate null = still-open phase: the window end must come from the
      // injected coach-local today, not the server clock (a fixed past date
      // that can never equal the host clock makes this discriminating).
      const openPhaseRow = createMockPhaseRow({
        id: PHASE_ID,
        clientId: CLIENT_ID,
        status: "active",
        startDate: "2026-01-01",
        endDate: null,
        roadmapId: "roadmap-1",
      });
      const phaseQuery = createMockQuery({ data: openPhaseRow, error: null });
      const trainingQuery = createMockQuery({ data: null, error: null });
      const sessionLogsQuery = createMockQuery({ data: null, error: null, count: 5 });
      const nutritionLogsQuery = createMockQuery({ data: [], error: null });
      const habitsQuery = createMockQuery({ data: [], error: null });
      const nextPhaseQuery = createMockQuery({ data: null, error: null });

      let phasesCallCount = 0;
      vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
        if (table === "phases") {
          phasesCallCount++;
          return phasesCallCount === 1 ? phaseQuery : nextPhaseQuery;
        }
        if (table === "training_plans") return trainingQuery;
        if (table === "session_logs") return sessionLogsQuery;
        if (table === "nutrition_logs") return nutritionLogsQuery;
        if (table === "daily_habits") return habitsQuery;
        return createMockQuery({ data: null, error: null });
      }) as never);

      vi.mocked(getBodyMetricsHistory).mockResolvedValue([]);
      vi.mocked(getLatestBodyMetrics).mockResolvedValue(null);
      vi.mocked(getCurrentGoals).mockResolvedValue(null);

      await getPhaseReviewData(PHASE_ID, CLIENT_ID, "2026-01-31");

      expect(sessionLogsQuery.lte).toHaveBeenCalledWith("completed_at", "2026-01-31");
      expect(nutritionLogsQuery.lte).toHaveBeenCalledWith("date", "2026-01-31");
    });
  });

  describe("transitionPhase", () => {
    it("calls getPhaseReviewData then RPC with correct params", async () => {
      const mockPhaseRow = createMockPhaseRow({
        id: PHASE_ID,
        clientId: CLIENT_ID,
        status: "active",
        startDate: "2026-01-01",
        roadmapId: "roadmap-1",
      });

      // Setup for getPhaseReviewData
      const phaseQuery = createMockQuery({ data: mockPhaseRow, error: null });
      const emptyQuery = createMockQuery({ data: null, error: null });
      const emptyArrayQuery = createMockQuery({ data: [], error: null });

      vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
        if (table === "phases") return phaseQuery;
        if (table === "nutrition_logs") return emptyArrayQuery;
        if (table === "daily_habits") return emptyArrayQuery;
        return emptyQuery;
      }) as never);

      vi.mocked(getBodyMetricsHistory).mockResolvedValue([]);
      vi.mocked(getLatestBodyMetrics).mockResolvedValue(null);
      vi.mocked(getCurrentGoals).mockResolvedValue(null);

      // Mock RPC
      vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
        data: "phase-2",
        error: null,
      } as never);

      const result = await transitionPhase(PHASE_ID, CLIENT_ID, {
        coachReflection: "Great progress",
        nextAction: "activate_next",
        planHandling: {
          trainingPlan: "archive",
          nutritionPlan: "keep",
          habits: "archive",
        },
      });

      expect(result.resultId).toBe("phase-2");
      expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
        "transition_phase_atomic",
        expect.objectContaining({
          p_phase_id: PHASE_ID,
          p_coach_reflection: "Great progress",
          p_next_action: "activate_next",
          p_archive_training: true,
          p_archive_nutrition: false,
          p_archive_habits: true,
        })
      );
    });

    it("passes archive flags correctly based on planHandling options", async () => {
      const mockPhaseRow = createMockPhaseRow({
        id: PHASE_ID,
        clientId: CLIENT_ID,
        status: "active",
        startDate: "2026-01-01",
        roadmapId: "roadmap-1",
      });

      const phaseQuery = createMockQuery({ data: mockPhaseRow, error: null });
      const emptyQuery = createMockQuery({ data: null, error: null });
      const emptyArrayQuery = createMockQuery({ data: [], error: null });

      vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
        if (table === "phases") return phaseQuery;
        if (table === "nutrition_logs") return emptyArrayQuery;
        if (table === "daily_habits") return emptyArrayQuery;
        return emptyQuery;
      }) as never);

      vi.mocked(getBodyMetricsHistory).mockResolvedValue([]);
      vi.mocked(getLatestBodyMetrics).mockResolvedValue(null);
      vi.mocked(getCurrentGoals).mockResolvedValue(null);

      vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
        data: PHASE_ID,
        error: null,
      } as never);

      await transitionPhase(PHASE_ID, CLIENT_ID, {
        nextAction: "archive_roadmap",
        planHandling: {
          trainingPlan: "keep",
          nutritionPlan: "archive",
          habits: "keep",
        },
      });

      expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
        "transition_phase_atomic",
        expect.objectContaining({
          p_next_action: "archive_roadmap",
          p_archive_training: false,
          p_archive_nutrition: true,
          p_archive_habits: false,
        })
      );
    });
  });
});
