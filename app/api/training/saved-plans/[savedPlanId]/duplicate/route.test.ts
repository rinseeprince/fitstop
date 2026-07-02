import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/services/coach-saved-plan-service", () => ({
  duplicateSavedPlan: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedCoachId: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));

import { POST } from "./route";
import { duplicateSavedPlan } from "@/services/coach-saved-plan-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";

const mockDuplicate = vi.mocked(duplicateSavedPlan);
const mockAuth = vi.mocked(getAuthenticatedCoachId);

function makeRequest() {
  return new NextRequest("http://localhost/api/training/saved-plans/plan-1/duplicate", {
    method: "POST",
  });
}

const params = { params: Promise.resolve({ savedPlanId: "plan-1" }) };

describe("POST /api/training/saved-plans/[savedPlanId]/duplicate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue("coach-1");
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(makeRequest(), params);
    expect(res.status).toBe(401);
    expect(mockDuplicate).not.toHaveBeenCalled();
  });

  it("duplicates and returns the new plan id", async () => {
    mockDuplicate.mockResolvedValue("plan-2");
    const res = await POST(makeRequest(), params);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ success: true, planId: "plan-2" });
    expect(mockDuplicate).toHaveBeenCalledWith("plan-1", "coach-1");
  });

  it("maps Plan not found to 404", async () => {
    mockDuplicate.mockRejectedValue(new Error("Plan not found"));
    const res = await POST(makeRequest(), params);
    expect(res.status).toBe(404);
  });

  it("returns 500 on service failure", async () => {
    mockDuplicate.mockRejectedValue(new Error("boom"));
    const res = await POST(makeRequest(), params);
    expect(res.status).toBe(500);
  });
});
