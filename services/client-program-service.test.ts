import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

import { supabaseAdmin } from "./supabase-admin";
import { getClientProgram } from "./client-program-service";

const mockFrom = vi.mocked(supabaseAdmin.from);

const CLIENT_ID = "client-1";

function createMockQuery<T = unknown>(result: {
  data: T | null;
  error: { message: string } | null;
}) {
  const q = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: vi.fn(),
  };
  Object.defineProperty(q, "then", {
    value: (resolve: (value: typeof result) => void) =>
      Promise.resolve(result).then(resolve),
  });
  return q;
}

describe("client-program-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no active roadmap exists", async () => {
    const roadmapQuery = createMockQuery({ data: null, error: null });
    mockFrom.mockReturnValue(roadmapQuery as any);

    const result = await getClientProgram(CLIENT_ID);

    expect(result).toBeNull();
    expect(mockFrom).toHaveBeenCalledWith("roadmaps");
  });

  it("returns roadmap with phases, activePhaseId, client metrics, and new fields", async () => {
    const roadmapRow = {
      id: "roadmap-1",
      client_id: CLIENT_ID,
      coach_id: "coach-1",
      name: "Strength Block",
      long_term_goal: "Get stronger",
      goal_weight: 75,
      goal_body_fat_percentage: 12,
      status: "active",
      started_at: "2026-04-01",
      target_end_date: "2026-07-01",
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
    };

    const phaseRows = [
      {
        id: "phase-1",
        roadmap_id: "roadmap-1",
        client_id: CLIENT_ID,
        name: "Hypertrophy",
        description: "Volume block",
        objectives: null,
        order_index: 0,
        status: "completed",
        start_date: "2026-04-01",
        end_date: "2026-04-28",
        duration_weeks: 4,
        phase_goal_weight: 78,
        phase_goal_body_fat_percentage: 15,
        coach_reflection: "Solid block",
        milestones: [],
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-28T00:00:00Z",
      },
      {
        id: "phase-2",
        roadmap_id: "roadmap-1",
        client_id: CLIENT_ID,
        name: "Strength",
        description: null,
        objectives: "Hit PRs",
        order_index: 1,
        status: "active",
        start_date: "2026-04-29",
        end_date: null,
        duration_weeks: 6,
        phase_goal_weight: 76,
        phase_goal_body_fat_percentage: null,
        coach_reflection: null,
        milestones: [{ id: "m1", text: "Squat 200kg", completed: false, completed_at: null }],
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-29T00:00:00Z",
      },
    ];

    const clientRow = {
      weight_unit: "kg",
      starting_weight: 85,
      current_weight: 80,
    };

    const roadmapQuery = createMockQuery({ data: roadmapRow, error: null });
    const phasesQuery = createMockQuery({ data: phaseRows, error: null });
    const clientQuery = createMockQuery({ data: clientRow, error: null });

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return roadmapQuery as any;
      if (callCount === 2) return phasesQuery as any;
      return clientQuery as any;
    });

    const result = await getClientProgram(CLIENT_ID);

    expect(result).not.toBeNull();
    expect(result!.roadmap.id).toBe("roadmap-1");
    expect(result!.roadmap.name).toBe("Strength Block");
    expect(result!.roadmap.longTermGoal).toBe("Get stronger");
    expect(result!.roadmap.goalWeight).toBe(75);
    expect(result!.roadmap.goalBodyFatPercentage).toBe(12);
    expect(result!.phases).toHaveLength(2);
    expect(result!.phases[0].status).toBe("completed");
    expect(result!.phases[0].phaseGoalWeight).toBe(78);
    expect(result!.phases[0].phaseGoalBodyFatPercentage).toBe(15);
    expect(result!.phases[0].coachReflection).toBe("Solid block");
    expect(result!.phases[1].status).toBe("active");
    expect(result!.phases[1].phaseGoalWeight).toBe(76);
    expect(result!.phases[1].coachReflection).toBeNull();
    expect(result!.activePhaseId).toBe("phase-2");
    expect(result!.weightUnit).toBe("kg");
    expect(result!.metrics.startingWeight).toBe(85);
    expect(result!.metrics.currentWeight).toBe(80);
  });

  it("returns activePhaseId null when no phase is active and falls back to lbs when client row missing", async () => {
    const roadmapRow = {
      id: "roadmap-1",
      client_id: CLIENT_ID,
      name: "Cut",
      long_term_goal: null,
      goal_weight: null,
      goal_body_fat_percentage: null,
      status: "active",
      started_at: null,
      target_end_date: null,
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
    };

    const phaseRows = [
      {
        id: "phase-1",
        roadmap_id: "roadmap-1",
        client_id: CLIENT_ID,
        name: "Phase 1",
        description: null,
        objectives: null,
        order_index: 0,
        status: "planned",
        start_date: null,
        end_date: null,
        duration_weeks: null,
        phase_goal_weight: null,
        phase_goal_body_fat_percentage: null,
        coach_reflection: null,
        milestones: [],
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-01T00:00:00Z",
      },
    ];

    const roadmapQuery = createMockQuery({ data: roadmapRow, error: null });
    const phasesQuery = createMockQuery({ data: phaseRows, error: null });
    const clientQuery = createMockQuery({ data: null, error: null });

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return roadmapQuery as any;
      if (callCount === 2) return phasesQuery as any;
      return clientQuery as any;
    });

    const result = await getClientProgram(CLIENT_ID);

    expect(result).not.toBeNull();
    expect(result!.activePhaseId).toBeNull();
    expect(result!.phases[0].status).toBe("planned");
    expect(result!.weightUnit).toBe("lbs");
    expect(result!.metrics.startingWeight).toBeNull();
    expect(result!.metrics.currentWeight).toBeNull();
  });
});
