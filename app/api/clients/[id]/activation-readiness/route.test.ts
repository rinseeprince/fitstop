import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET } from "./route";

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/require-coach-auth", () => ({
  requireCoachOwnsClient: vi.fn(),
}));

vi.mock("@/services/training-service", () => ({
  getActiveTrainingPlan: vi.fn(),
}));

vi.mock("@/services/client-habit-figures-service", () => ({
  hasHabitFromToday: vi.fn(),
}));

// Client-local today, read once by the route for the items judged on it.
vi.mock("@/services/today-service", () => ({
  getClientTodayString: vi.fn(),
}));

// Versioned model (migration 144): readiness resolves through the date
// resolvers — covering-or-future, the same predicate as the client log guard.
vi.mock("@/services/nutrition-plan-service", () => ({
  getNutritionPlanIdForDate: vi.fn(),
  getNextFutureNutritionPlan: vi.fn(),
}));

import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getActiveTrainingPlan } from "@/services/training-service";
import { hasHabitFromToday } from "@/services/client-habit-figures-service";
import { getClientTodayString } from "@/services/today-service";
import {
  getNutritionPlanIdForDate,
  getNextFutureNutritionPlan,
} from "@/services/nutrition-plan-service";

const mockParams = { params: Promise.resolve({ id: "client-1" }) };

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
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({ authorized: true, coachId: "coach-1" });
    vi.mocked(getClientTodayString).mockResolvedValue("2026-01-15");
    vi.mocked(getActiveTrainingPlan).mockResolvedValue({ id: "tp-1" } as never);
    vi.mocked(hasHabitFromToday).mockResolvedValue(true);
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

  it("checks the coach owns the client with the route's request, as every client route does", async () => {
    const request = createMockRequest();
    await GET(request, mockParams);
    expect(requireCoachOwnsClient).toHaveBeenCalledWith("client-1", request);
  });

  it("answers the ownership check's refusal and reads nothing — unauthenticated, or a client not this coach's", async () => {
    vi.mocked(requireCoachOwnsClient).mockResolvedValueOnce({
      authorized: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    expect((await GET(createMockRequest(), mockParams)).status).toBe(401);

    // Another coach's client, or none at all, is not found — never a 403 that
    // says it exists.
    vi.mocked(requireCoachOwnsClient).mockResolvedValueOnce({
      authorized: false,
      response: NextResponse.json({ error: "Client not found" }, { status: 404 }),
    });
    expect((await GET(createMockRequest(), mockParams)).status).toBe(404);

    expect(getClientTodayString).not.toHaveBeenCalled();
    expect(getActiveTrainingPlan).not.toHaveBeenCalled();
    expect(hasHabitFromToday).not.toHaveBeenCalled();
    expect(getNutritionPlanIdForDate).not.toHaveBeenCalled();
  });

  it("stops at the rate limit before the coach is read", async () => {
    vi.mocked(coachApiRateLimit).mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    expect((await GET(createMockRequest(), mockParams)).status).toBe(429);
    expect(requireCoachOwnsClient).not.toHaveBeenCalled();
  });

  it("reads the client's today once, and judges both the habits and the nutrition item on it", async () => {
    await GET(createMockRequest(), mockParams);

    expect(getClientTodayString).toHaveBeenCalledTimes(1);
    expect(getClientTodayString).toHaveBeenCalledWith("client-1");
    expect(hasHabitFromToday).toHaveBeenCalledWith("client-1", "2026-01-15");
    expect(getNutritionPlanIdForDate).toHaveBeenCalledWith("client-1", "2026-01-15");
  });

  it("a failed read of today fails the two items judged on it, and no other", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(getClientTodayString).mockRejectedValue(new Error("DB error"));

    const response = await GET(createMockRequest(), mockParams);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data).toEqual({ hasTrainingPlan: true, hasNutritionPlan: false, hasHabits: false });
    expect(hasHabitFromToday).not.toHaveBeenCalled();
    vi.mocked(console.error).mockRestore();
  });

  it("returns hasHabits=false with no habit running today or later — none, or every one stopped", async () => {
    vi.mocked(hasHabitFromToday).mockResolvedValue(false);

    const response = await GET(createMockRequest(), mockParams);
    const json = await response.json();

    expect(json.data.hasHabits).toBe(false);
    expect(json.data.hasTrainingPlan).toBe(true);
  });

  it("habit query failure reads as no habits and still returns the other flags", async () => {
    vi.mocked(hasHabitFromToday).mockRejectedValue(new Error("DB error"));

    const response = await GET(createMockRequest(), mockParams);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.hasHabits).toBe(false);
    expect(json.data.hasTrainingPlan).toBe(true);
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
    expect(getNextFutureNutritionPlan).toHaveBeenCalledWith("client-1", "2026-01-15");
  });
});
