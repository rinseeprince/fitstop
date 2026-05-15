import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET } from "./route";
import type { ClientTrainingPlan } from "@/types/client-training-plan";

vi.mock("@/lib/rate-limit", () => ({
  clientApiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedClientId: vi.fn(),
}));

vi.mock("@/services/client-training-plan-service", () => ({
  getClientTrainingPlan: vi.fn(),
}));

import { clientApiRateLimit } from "@/lib/rate-limit";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { getClientTrainingPlan } from "@/services/client-training-plan-service";

const mockPlan: ClientTrainingPlan = {
  planId: "plan-1",
  planName: "PPL+Rest",
  cycleLength: 5,
  restPattern: [2, 4],
  sessions: [
    {
      id: "s-0",
      name: "Push",
      focus: "Chest",
      orderIndex: 0,
      isRest: false,
      estimatedDurationMinutes: 60,
      exercises: [],
    },
  ],
};

function createMockRequest() {
  return new NextRequest("http://localhost:3000/api/client/training-plan", {
    method: "GET",
  });
}

describe("/api/client/training-plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clientApiRateLimit).mockResolvedValue(null);
  });

  it("returns the training plan for an authenticated client", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue("client-1");
    vi.mocked(getClientTrainingPlan).mockResolvedValue(mockPlan);

    const response = await GET(createMockRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.planName).toBe("PPL+Rest");
    expect(body.data.cycleLength).toBe(5);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns null data when no active plan", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue("client-1");
    vi.mocked(getClientTrainingPlan).mockResolvedValue(null);

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
    expect(getClientTrainingPlan).not.toHaveBeenCalled();
  });
});
