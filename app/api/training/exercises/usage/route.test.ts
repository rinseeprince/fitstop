import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/services/exercise-catalog-service", () => ({
  getExerciseUsageForCoach: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedCoachId: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));

import { GET } from "./route";
import { getExerciseUsageForCoach } from "@/services/exercise-catalog-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";

const mockUsage = vi.mocked(getExerciseUsageForCoach);
const mockAuth = vi.mocked(getAuthenticatedCoachId);

function makeRequest() {
  return new NextRequest("http://localhost/api/training/exercises/usage");
}

describe("GET /api/training/exercises/usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue("coach-1");
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns the usage aggregate", async () => {
    mockUsage.mockResolvedValue({
      perExercise: [{ exerciseId: "ex-1", sessionCount: 3 }],
      sessionsWithLinks: 3,
    });
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.usage.perExercise).toHaveLength(1);
    expect(mockUsage).toHaveBeenCalledWith("coach-1");
  });

  it("returns 500 on service failure", async () => {
    mockUsage.mockRejectedValue(new Error("boom"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
  });
});
