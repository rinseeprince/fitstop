import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET, PUT, DELETE } from "./route";

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/require-coach-auth", () => ({
  requireCoachOwnsClient: vi.fn(),
}));

vi.mock("@/services/phase-service", () => ({
  updatePhase: vi.fn(),
  deletePhase: vi.fn(),
}));

vi.mock("@/services/roadmap-service", () => ({
  mapPhaseRow: vi.fn(),
}));

// Mock supabase-admin with chainable query builder
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockMaybeSingle = vi.fn();

vi.mock("@/services/supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: mockMaybeSingle,
          // For linked plans queries (no maybeSingle)
          data: null,
          error: null,
        })),
      })),
    })),
  },
}));

import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { updatePhase, deletePhase } from "@/services/phase-service";
import { mapPhaseRow } from "@/services/roadmap-service";
import { supabaseAdmin } from "@/services/supabase-admin";

const mockParams = { params: Promise.resolve({ id: "client-1", phaseId: "phase-1" }) };

const mockPhaseRow = {
  id: "phase-1",
  roadmap_id: "roadmap-1",
  client_id: "client-1",
  name: "Foundation",
  description: "Build base fitness",
  objectives: "Establish routine",
  order_index: 0,
  status: "planned",
  start_date: "2024-01-01",
  end_date: "2024-02-01",
  duration_weeks: 4,
  phase_goals_snapshot: null,
  phase_goal_weight: null,
  phase_goal_body_fat_percentage: null,
  coach_reflection: null,
  phase_summary: null,
  milestones: [],
  completion_seen: false,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

const mockPhase = {
  id: "phase-1",
  roadmapId: "roadmap-1",
  clientId: "client-1",
  name: "Foundation",
  description: "Build base fitness",
  objectives: "Establish routine",
  orderIndex: 0,
  status: "planned" as const,
  startDate: "2024-01-01",
  endDate: "2024-02-01",
  durationWeeks: 4,
  phaseGoalsSnapshot: null,
  phaseGoalWeight: null,
  phaseGoalBodyFatPercentage: null,
  phaseSummary: null,
  milestones: [],
  completionSeen: false,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

function createMockRequest(method: string, body?: Record<string, unknown>) {
  return new NextRequest(
    "http://localhost:3000/api/clients/client-1/roadmap/phases/phase-1",
    {
      method,
      ...(body
        ? {
            body: JSON.stringify(body),
            headers: { "Content-Type": "application/json" },
          }
        : {}),
    }
  );
}

// Helper to set up supabase mock matching on table name
function setupSupabaseMock(
  phaseRow: typeof mockPhaseRow | null,
  linkedPlans?: {
    trainingPlans?: unknown[];
    nutritionPlans?: unknown[];
    habits?: unknown[];
  }
) {
  const tableData: Record<string, unknown[]> = {
    training_plans: linkedPlans?.trainingPlans || [],
    nutrition_plans: linkedPlans?.nutritionPlans || [],
    daily_habits: linkedPlans?.habits || [],
  };

  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === "phases") {
      // Chain: .select("*").eq("id", phaseId).eq("client_id", clientId).maybeSingle()
      const maybeSingleFn = vi.fn().mockResolvedValue({
        data: phaseRow,
        error: null,
      });
      const secondEq = vi.fn().mockReturnValue({ maybeSingle: maybeSingleFn });
      const firstEq = vi.fn().mockReturnValue({ eq: secondEq, maybeSingle: maybeSingleFn });
      return {
        select: vi.fn().mockReturnValue({ eq: firstEq }),
      } as never;
    }
    // Linked plan queries (training_plans, nutrition_plans, daily_habits)
    return {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          data: tableData[table] || [],
          error: null,
        }),
      }),
    } as never;
  });
}

describe("/api/clients/[id]/roadmap/phases/[phaseId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: true,
      coachId: "coach-1",
    });
  });

  describe("GET", () => {
    it("returns phase detail with linked plans", async () => {
      const trainingPlans = [{ id: "tp-1", name: "Plan A", status: "active" }];
      const nutritionPlans = [{ id: "np-1", status: "active", effective_from: "2024-01-01" }];
      const habits = [{ id: "h-1", name: "Drink water", is_active: true }];

      setupSupabaseMock(mockPhaseRow, { trainingPlans, nutritionPlans, habits });
      vi.mocked(mapPhaseRow).mockReturnValue(mockPhase);

      const response = await GET(createMockRequest("GET"), mockParams);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.phase.name).toBe("Foundation");
      expect(data.data.linkedPlans.trainingPlans).toHaveLength(1);
      expect(data.data.linkedPlans.nutritionPlans).toHaveLength(1);
      expect(data.data.linkedPlans.habits).toHaveLength(1);
    });

    it("returns 404 when phase not found", async () => {
      setupSupabaseMock(null);

      const response = await GET(createMockRequest("GET"), mockParams);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
    });

    it("returns 404 when phase belongs to different client", async () => {
      // Query filters by client_id, so a phase from another client returns null
      setupSupabaseMock(null);

      const response = await GET(createMockRequest("GET"), mockParams);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
    });
  });

  describe("PUT", () => {
    it("updates phase with partial fields", async () => {
      vi.mocked(updatePhase).mockResolvedValue({
        ...mockPhase,
        name: "Updated Foundation",
      });

      const response = await PUT(
        createMockRequest("PUT", { name: "Updated Foundation" }),
        mockParams
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(updatePhase).toHaveBeenCalledWith("phase-1", "client-1", { name: "Updated Foundation" });
    });

    it("strips unknown fields like status from PUT body", async () => {
      // The updatePhaseSchema doesn't include status, so it will be stripped
      vi.mocked(updatePhase).mockResolvedValue(mockPhase);

      const response = await PUT(
        createMockRequest("PUT", { name: "Test", status: "active" }),
        mockParams
      );
      const data = await response.json();

      // Status field should be stripped by Zod, update proceeds with name only
      expect(response.status).toBe(200);
      expect(updatePhase).toHaveBeenCalledWith("phase-1", "client-1", { name: "Test" });
    });

    it("updates phase goal fields on a planned phase", async () => {
      vi.mocked(updatePhase).mockResolvedValue({
        ...mockPhase,
        phaseGoalWeight: 75,
        phaseGoalBodyFatPercentage: 15,
      });

      const response = await PUT(
        createMockRequest("PUT", { phaseGoalWeight: 75, phaseGoalBodyFatPercentage: 15 }),
        mockParams
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.phaseGoalWeight).toBe(75);
      expect(data.data.phaseGoalBodyFatPercentage).toBe(15);
      expect(updatePhase).toHaveBeenCalledWith("phase-1", "client-1", {
        phaseGoalWeight: 75,
        phaseGoalBodyFatPercentage: 15,
      });
    });

    it("returns 400 when updating goal on active phase (status guard)", async () => {
      vi.mocked(updatePhase).mockRejectedValue(
        new Error("Phase goals can only be edited while the phase is in planned status")
      );

      const response = await PUT(
        createMockRequest("PUT", { phaseGoalWeight: 75 }),
        mockParams
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Phase goals can only be edited while the phase is in planned status");
    });

    it("clears goal override with null on a planned phase", async () => {
      vi.mocked(updatePhase).mockResolvedValue({
        ...mockPhase,
        phaseGoalWeight: null,
      });

      const response = await PUT(
        createMockRequest("PUT", { phaseGoalWeight: null }),
        mockParams
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(updatePhase).toHaveBeenCalledWith("phase-1", "client-1", { phaseGoalWeight: null });
    });
  });

  describe("DELETE", () => {
    it("deletes planned phase successfully", async () => {
      vi.mocked(deletePhase).mockResolvedValue(undefined);

      const response = await DELETE(createMockRequest("DELETE"), mockParams);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(deletePhase).toHaveBeenCalledWith("phase-1", "client-1");
    });

    it("returns 400 when phase is active", async () => {
      vi.mocked(deletePhase).mockRejectedValue(
        new Error("This phase has been started or completed and cannot be deleted.")
      );

      const response = await DELETE(createMockRequest("DELETE"), mockParams);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("has been started or completed");
    });

    it("returns 400 when phase is completed", async () => {
      vi.mocked(deletePhase).mockRejectedValue(
        new Error("This phase has been started or completed and cannot be deleted.")
      );

      const response = await DELETE(createMockRequest("DELETE"), mockParams);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("cannot be deleted");
    });
  });
});
