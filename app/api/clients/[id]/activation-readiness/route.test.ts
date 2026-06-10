import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedCoachId: vi.fn(),
}));

vi.mock("@/services/client-service", () => ({
  getClientById: vi.fn(),
}));

vi.mock("@/services/training-service", () => ({
  getActiveTrainingPlan: vi.fn(),
}));

vi.mock("@/services/daily-habits-service", () => ({
  getClientHabits: vi.fn(),
}));

vi.mock("@/services/roadmap-service", () => ({
  getActiveRoadmap: vi.fn(),
}));

vi.mock("@/services/phase-service", () => ({
  getActivePhase: vi.fn(),
}));

// The real promoteNutritionPlanIfReady runs in these tests; it now resolves
// the client-local today through today-service before touching the DB.
vi.mock("@/services/today-service", () => ({
  getClientTodayString: vi.fn().mockResolvedValue("2026-01-15"),
}));

const mockMaybeSingle = vi.fn();
vi.mock("@/services/supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            limit: vi.fn(() => ({
              maybeSingle: mockMaybeSingle,
            })),
            lte: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            })),
          })),
        })),
      })),
    })),
  },
}));

import { coachApiRateLimit } from "@/lib/rate-limit";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { getClientById } from "@/services/client-service";
import { getActiveTrainingPlan } from "@/services/training-service";
import { getClientHabits } from "@/services/daily-habits-service";
import { getActiveRoadmap } from "@/services/roadmap-service";
import { getActivePhase } from "@/services/phase-service";

const mockParams = { params: Promise.resolve({ id: "client-1" }) };

const mockClient = {
  id: "client-1",
  coachId: "coach-1",
  name: "Test Client",
  email: "test@example.com",
};

const mockRoadmap = {
  id: "roadmap-1",
  clientId: "client-1",
  coachId: "coach-1",
  name: "12-Week Plan",
  status: "active" as const,
  phases: [],
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

const mockPhase = {
  id: "phase-1",
  roadmapId: "roadmap-1",
  clientId: "client-1",
  name: "Hypertrophy Block",
  status: "active" as const,
  startDate: "2024-02-01",
  endDate: "2024-03-01",
  orderIndex: 0,
  milestones: [],
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

function createMockRequest() {
  return new NextRequest(
    "http://localhost:3000/api/clients/client-1/activation-readiness",
    { method: "GET" }
  );
}

describe("/api/clients/[id]/activation-readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(coachApiRateLimit).mockResolvedValue(null);
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue("coach-1");
    vi.mocked(getClientById).mockResolvedValue(mockClient as never);
    vi.mocked(getActiveTrainingPlan).mockResolvedValue({ id: "tp-1" } as never);
    vi.mocked(getClientHabits).mockResolvedValue([{ id: "habit-1" }] as never);
    mockMaybeSingle.mockResolvedValue({ data: { id: "np-1" }, error: null });
    vi.mocked(getActiveRoadmap).mockResolvedValue(mockRoadmap);
    vi.mocked(getActivePhase).mockResolvedValue(mockPhase);
  });

  it("returns all readiness flags including roadmap", async () => {
    const response = await GET(createMockRequest(), mockParams);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual({
      hasTrainingPlan: true,
      hasNutritionPlan: true,
      hasHabits: true,
      hasRoadmap: true,
      hasActivePhase: true,
      activePhaseName: "Hypertrophy Block",
      activePhaseStartDate: "2024-02-01",
      roadmapRecommended: true,
    });
  });

  it("returns hasRoadmap=false when no roadmap", async () => {
    vi.mocked(getActiveRoadmap).mockResolvedValue(null);
    vi.mocked(getActivePhase).mockResolvedValue(null);

    const response = await GET(createMockRequest(), mockParams);
    const json = await response.json();

    expect(json.data.hasRoadmap).toBe(false);
    expect(json.data.hasActivePhase).toBe(false);
    expect(json.data.activePhaseName).toBeNull();
    expect(json.data.activePhaseStartDate).toBeNull();
  });

  it("returns hasActivePhase=false when roadmap exists but no active phase", async () => {
    vi.mocked(getActivePhase).mockResolvedValue(null);

    const response = await GET(createMockRequest(), mockParams);
    const json = await response.json();

    expect(json.data.hasRoadmap).toBe(true);
    expect(json.data.hasActivePhase).toBe(false);
    expect(json.data.activePhaseName).toBeNull();
  });

  it("returns all true when fully set up", async () => {
    const response = await GET(createMockRequest(), mockParams);
    const json = await response.json();

    expect(json.data.hasTrainingPlan).toBe(true);
    expect(json.data.hasNutritionPlan).toBe(true);
    expect(json.data.hasHabits).toBe(true);
    expect(json.data.hasRoadmap).toBe(true);
    expect(json.data.hasActivePhase).toBe(true);
  });

  it("roadmapRecommended is always true", async () => {
    vi.mocked(getActiveRoadmap).mockResolvedValue(null);
    vi.mocked(getActivePhase).mockResolvedValue(null);

    const response = await GET(createMockRequest(), mockParams);
    const json = await response.json();

    expect(json.data.roadmapRecommended).toBe(true);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(null);

    const response = await GET(createMockRequest(), mockParams);
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.success).toBe(false);
  });

  it("returns 404 when client not found", async () => {
    vi.mocked(getClientById).mockResolvedValue(null);

    const response = await GET(createMockRequest(), mockParams);
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.success).toBe(false);
  });

  it("returns 403 when coach doesn't own client", async () => {
    vi.mocked(getClientById).mockResolvedValue({
      ...mockClient,
      coachId: "other-coach",
    } as never);

    const response = await GET(createMockRequest(), mockParams);
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.success).toBe(false);
    expect(json.error).toBe("Forbidden");
  });

  it("roadmap query failure doesn't break response", async () => {
    vi.mocked(getActiveRoadmap).mockRejectedValue(new Error("DB error"));

    const response = await GET(createMockRequest(), mockParams);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.hasRoadmap).toBe(false);
    expect(json.data.hasTrainingPlan).toBe(true);
    expect(json.data.hasNutritionPlan).toBe(true);
    expect(json.data.hasHabits).toBe(true);
  });

  it("training plan query failure still returns other flags", async () => {
    vi.mocked(getActiveTrainingPlan).mockRejectedValue(new Error("DB error"));

    const response = await GET(createMockRequest(), mockParams);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.hasTrainingPlan).toBe(false);
    expect(json.data.hasNutritionPlan).toBe(true);
    expect(json.data.hasHabits).toBe(true);
    expect(json.data.hasRoadmap).toBe(true);
    expect(json.data.hasActivePhase).toBe(true);
  });
});
