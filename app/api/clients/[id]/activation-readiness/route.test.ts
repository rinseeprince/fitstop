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

// Client-local today is resolved through today-service by downstream reads.
vi.mock("@/services/today-service", () => ({
  getClientTodayString: vi.fn().mockResolvedValue("2026-01-15"),
}));

// Versioned model (migration 144): readiness resolves through the date
// resolvers — covering-or-future, the same predicate as the client log guard.
vi.mock("@/services/nutrition-plan-service", () => ({
  getNutritionPlanIdForDate: vi.fn(),
  getNextFutureNutritionPlan: vi.fn(),
}));

import { coachApiRateLimit } from "@/lib/rate-limit";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { getClientById } from "@/services/client-service";
import { getActiveTrainingPlan } from "@/services/training-service";
import { getClientHabits } from "@/services/daily-habits-service";
import {
  getNutritionPlanIdForDate,
  getNextFutureNutritionPlan,
} from "@/services/nutrition-plan-service";

const mockParams = { params: Promise.resolve({ id: "client-1" }) };

const mockClient = {
  id: "client-1",
  coachId: "coach-1",
  name: "Test Client",
  email: "test@example.com",
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
    vi.mocked(getNutritionPlanIdForDate).mockResolvedValue("np-1");
    vi.mocked(getNextFutureNutritionPlan).mockResolvedValue(null);
  });

  it("returns the three required readiness flags", async () => {
    const response = await GET(createMockRequest(), mockParams);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual({
      hasTrainingPlan: true,
      hasNutritionPlan: true,
      hasHabits: true,
    });
  });

  it("returns hasHabits=false with no habits", async () => {
    vi.mocked(getClientHabits).mockResolvedValue([] as never);

    const response = await GET(createMockRequest(), mockParams);
    const json = await response.json();

    expect(json.data.hasHabits).toBe(false);
    expect(json.data.hasTrainingPlan).toBe(true);
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

  it("training plan query failure still returns other flags", async () => {
    vi.mocked(getActiveTrainingPlan).mockRejectedValue(new Error("DB error"));

    const response = await GET(createMockRequest(), mockParams);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.hasTrainingPlan).toBe(false);
    expect(json.data.hasNutritionPlan).toBe(true);
    expect(json.data.hasHabits).toBe(true);
  });

  it("a coach who queued a FIRST plan is ready — covering-or-future, aligned with the client log guard", async () => {
    vi.mocked(getNutritionPlanIdForDate).mockResolvedValue(null);
    vi.mocked(getNextFutureNutritionPlan).mockResolvedValue({
      id: "np-queued",
      effectiveFrom: "2026-02-01",
    });

    const response = await GET(createMockRequest(), mockParams);
    const json = await response.json();

    expect(json.data.hasNutritionPlan).toBe(true);
  });
});
