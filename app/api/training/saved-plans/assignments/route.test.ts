import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/services/coach-saved-plan-service", () => ({
  getSavedPlanAssignments: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedCoachId: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));

import { GET } from "./route";
import { getSavedPlanAssignments } from "@/services/coach-saved-plan-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";

const mockAssignments = vi.mocked(getSavedPlanAssignments);
const mockAuth = vi.mocked(getAuthenticatedCoachId);

function makeRequest() {
  return new NextRequest("http://localhost/api/training/saved-plans/assignments");
}

describe("GET /api/training/saved-plans/assignments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue("coach-1");
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns the assignment aggregate", async () => {
    mockAssignments.mockResolvedValue({
      perPlan: [{ savedPlanId: "plan-1", count: 2 }],
      totalAssignments: 2,
      distinctClients: 2,
    });
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.assignments.totalAssignments).toBe(2);
    expect(mockAssignments).toHaveBeenCalledWith("coach-1");
  });

  it("returns 500 on service failure", async () => {
    mockAssignments.mockRejectedValue(new Error("boom"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
  });
});
