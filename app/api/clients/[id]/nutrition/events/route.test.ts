import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { NutritionEvent } from "@/types/check-in";

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedCoachId: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/services/client-service", () => ({
  getClientById: vi.fn(),
}));

vi.mock("@/services/nutrition-event-service", () => ({
  getNutritionEventsForDateRange: vi.fn(),
}));

import { GET } from "./route";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { getClientById } from "@/services/client-service";
import { getNutritionEventsForDateRange } from "@/services/nutrition-event-service";

const mockCoachId = vi.mocked(getAuthenticatedCoachId);
const mockGetClient = vi.mocked(getClientById);
const mockGetEvents = vi.mocked(getNutritionEventsForDateRange);

function makeRequest(query = "?startDate=2026-06-01&endDate=2026-06-30") {
  return new NextRequest(`http://localhost/api/clients/c1/nutrition/events${query}`);
}

const params = Promise.resolve({ id: "c1" });

const sampleEvent: NutritionEvent = {
  id: "ne-1",
  clientId: "c1",
  nutritionPlanId: "np-1",
  date: "2026-06-10",
  dayOfWeek: "wednesday",
  baselineCalories: 2000,
  trainingBurnCalories: 0,
  proteinG: 160,
  carbG: 200,
  fatG: 67,
  dietType: "balanced",
  isTrainingDay: true,
  calorieSurplusPercentage: 5,
  isModified: true,
  note: null,
  status: "scheduled",
  createdAt: "",
  updatedAt: "",
};

describe("GET /api/clients/[id]/nutrition/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCoachId.mockResolvedValue("coach-1");
    mockGetClient.mockResolvedValue({ id: "c1", coachId: "coach-1" } as never);
    mockGetEvents.mockResolvedValue([sampleEvent]);
  });

  it("returns 401 when not authenticated", async () => {
    mockCoachId.mockResolvedValue(null);
    const res = await GET(makeRequest(), { params });
    expect(res.status).toBe(401);
  });

  it("returns 404 when the client does not exist", async () => {
    mockGetClient.mockResolvedValue(null);
    const res = await GET(makeRequest(), { params });
    expect(res.status).toBe(404);
  });

  it("returns 403 when the client belongs to another coach", async () => {
    mockGetClient.mockResolvedValue({ id: "c1", coachId: "other-coach" } as never);
    const res = await GET(makeRequest(), { params });
    expect(res.status).toBe(403);
  });

  it("returns 400 when dates are missing", async () => {
    const res = await GET(makeRequest("?startDate=2026-06-01"), { params });
    expect(res.status).toBe(400);
  });

  it("returns 400 on malformed dates", async () => {
    const res = await GET(makeRequest("?startDate=06-01-2026&endDate=2026-06-30"), { params });
    expect(res.status).toBe(400);
  });

  it("returns 400 when endDate precedes startDate", async () => {
    const res = await GET(makeRequest("?startDate=2026-06-30&endDate=2026-06-01"), { params });
    expect(res.status).toBe(400);
  });

  it("returns 200 with events carrying isModified", async () => {
    const res = await GET(makeRequest(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.events).toHaveLength(1);
    expect(body.events[0].isModified).toBe(true);
    expect(mockGetEvents).toHaveBeenCalledWith("c1", "2026-06-01", "2026-06-30");
  });
});
