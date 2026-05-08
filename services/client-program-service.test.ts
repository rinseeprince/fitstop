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

  it("returns roadmap with phases and activePhaseId", async () => {
    const roadmapRow = {
      id: "roadmap-1",
      client_id: CLIENT_ID,
      coach_id: "coach-1",
      name: "Strength Block",
      long_term_goal: "Get stronger",
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
        milestones: [{ id: "m1", text: "Squat 200kg", completed: false, completed_at: null }],
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-29T00:00:00Z",
      },
    ];

    // First call: roadmaps query (uses maybeSingle)
    const roadmapQuery = createMockQuery({ data: roadmapRow, error: null });
    // Second call: phases query (uses thenable)
    const phasesQuery = createMockQuery({ data: phaseRows, error: null });

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return roadmapQuery as any;
      return phasesQuery as any;
    });

    const result = await getClientProgram(CLIENT_ID);

    expect(result).not.toBeNull();
    expect(result!.roadmap.id).toBe("roadmap-1");
    expect(result!.roadmap.name).toBe("Strength Block");
    expect(result!.roadmap.longTermGoal).toBe("Get stronger");
    expect(result!.phases).toHaveLength(2);
    expect(result!.phases[0].status).toBe("completed");
    expect(result!.phases[1].status).toBe("active");
    expect(result!.activePhaseId).toBe("phase-2");
  });

  it("returns activePhaseId null when no phase is active", async () => {
    const roadmapRow = {
      id: "roadmap-1",
      client_id: CLIENT_ID,
      name: "Cut",
      long_term_goal: null,
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
        milestones: [],
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-01T00:00:00Z",
      },
    ];

    const roadmapQuery = createMockQuery({ data: roadmapRow, error: null });
    const phasesQuery = createMockQuery({ data: phaseRows, error: null });

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return roadmapQuery as any;
      return phasesQuery as any;
    });

    const result = await getClientProgram(CLIENT_ID);

    expect(result).not.toBeNull();
    expect(result!.activePhaseId).toBeNull();
    expect(result!.phases[0].status).toBe("planned");
  });
});
