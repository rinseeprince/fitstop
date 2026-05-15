import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET } from "./route";
import type { NutritionTargets } from "@/services/client-portal-service";

vi.mock("@/lib/rate-limit", () => ({
  clientApiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedClientId: vi.fn(),
}));

vi.mock("@/services/client-portal-service", () => ({
  getClientNutritionTargets: vi.fn(),
}));

import { clientApiRateLimit } from "@/lib/rate-limit";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { getClientNutritionTargets } from "@/services/client-portal-service";

const mockTargets: NutritionTargets = {
  planId: "plan-1",
  calorieTarget: 2400,
  proteinTargetG: 180,
  carbTargetG: 240,
  fatTargetG: 80,
  customMacrosEnabled: false,
  dietType: "balanced",
  unitPreference: "metric",
  baselineCalories: 2400,
  includeActivityBurn: true,
  dailyTargets: [],
};

function createMockRequest() {
  return new NextRequest("http://localhost:3000/api/client/nutrition-plan", {
    method: "GET",
  });
}

describe("/api/client/nutrition-plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clientApiRateLimit).mockResolvedValue(null);
  });

  it("returns the nutrition plan for an authenticated client", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue("client-1");
    vi.mocked(getClientNutritionTargets).mockResolvedValue(mockTargets);

    const response = await GET(createMockRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.planId).toBe("plan-1");
    expect(body.data.baselineCalories).toBe(2400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns null data when no active plan", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue("client-1");
    vi.mocked(getClientNutritionTargets).mockResolvedValue(null);

    const response = await GET(createMockRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toBeNull();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(null);

    const response = await GET(createMockRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Unauthorized");
  });

  it("respects rate limiting", async () => {
    const rateLimitResponse = NextResponse.json(
      { error: "Rate limited" },
      { status: 429 }
    );
    vi.mocked(clientApiRateLimit).mockResolvedValue(rateLimitResponse);

    const response = await GET(createMockRequest());

    expect(response).toBe(rateLimitResponse);
    expect(getAuthenticatedClientId).not.toHaveBeenCalled();
    expect(getClientNutritionTargets).not.toHaveBeenCalled();
  });
});
