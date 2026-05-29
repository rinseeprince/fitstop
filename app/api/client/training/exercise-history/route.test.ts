import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  clientApiRateLimit: vi.fn().mockResolvedValue(null),
  clientPerClientRateLimit: vi.fn().mockResolvedValue(null),
  apiRateLimit: vi.fn().mockResolvedValue(null),
  authRateLimit: vi.fn().mockResolvedValue(null),
  checkInRateLimit: vi.fn().mockResolvedValue(null),
  aiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedClientId: vi.fn(),
}));

vi.mock("@/services/exercise-analytics-service", () => ({
  getClientExerciseList: vi.fn(),
  getExerciseProgressionSeries: vi.fn(),
  getExercisePRs: vi.fn(),
}));

import { GET } from "./route";
import { clientApiRateLimit } from "@/lib/rate-limit";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import {
  getClientExerciseList,
  getExerciseProgressionSeries,
  getExercisePRs,
} from "@/services/exercise-analytics-service";

const CLIENT_ID = "22222222-2222-2222-2222-222222222222";

function makeRequest(qs: string): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/client/training/exercise-history?${qs}`,
    { method: "GET" },
  );
}

describe("GET /api/client/training/exercise-history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clientApiRateLimit).mockResolvedValue(null);
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(CLIENT_ID);
  });

  it("returns 200 with the exercise list scoped to the authed client", async () => {
    const list = [{ exerciseId: "e1", name: "Bench Press", logCount: 5, lastLoggedDate: "2026-05-01" }];
    vi.mocked(getClientExerciseList).mockResolvedValue(list as never);

    const response = await GET(makeRequest("metric=list"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: list });
    expect(getClientExerciseList).toHaveBeenCalledWith(CLIENT_ID);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 200 progression and forwards sessionCount + exerciseId", async () => {
    vi.mocked(getExerciseProgressionSeries).mockResolvedValue([] as never);

    const response = await GET(
      makeRequest("metric=progression&exerciseId=e1&sessionCount=24"),
    );

    expect(response.status).toBe(200);
    expect(getExerciseProgressionSeries).toHaveBeenCalledWith(CLIENT_ID, {
      exerciseId: "e1",
      exerciseName: undefined,
      sessionCount: 24,
    });
  });

  it("returns 200 prs scoped to the authed client by exerciseName", async () => {
    vi.mocked(getExercisePRs).mockResolvedValue([] as never);

    const response = await GET(makeRequest("metric=prs&exerciseName=Bench%20Press"));

    expect(response.status).toBe(200);
    expect(getExercisePRs).toHaveBeenCalledWith(CLIENT_ID, {
      exerciseId: undefined,
      exerciseName: "Bench Press",
    });
  });

  it("accepts sessionCount=500 (the 'All' mapping)", async () => {
    vi.mocked(getExerciseProgressionSeries).mockResolvedValue([] as never);

    const response = await GET(
      makeRequest("metric=progression&exerciseId=e1&sessionCount=500"),
    );

    expect(response.status).toBe(200);
    expect(getExerciseProgressionSeries).toHaveBeenCalledWith(
      CLIENT_ID,
      expect.objectContaining({ sessionCount: 500 }),
    );
  });

  it("returns 401 when unauthenticated and never calls the service", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(null);

    const response = await GET(makeRequest("metric=list"));

    expect(response.status).toBe(401);
    expect(getClientExerciseList).not.toHaveBeenCalled();
  });

  it("returns 400 when metric is missing", async () => {
    const response = await GET(makeRequest(""));
    expect(response.status).toBe(400);
  });

  it("returns 400 for an invalid metric", async () => {
    const response = await GET(makeRequest("metric=bogus"));
    expect(response.status).toBe(400);
  });

  it("returns 400 for progression without exerciseId or exerciseName", async () => {
    const response = await GET(makeRequest("metric=progression"));
    expect(response.status).toBe(400);
    expect(getExerciseProgressionSeries).not.toHaveBeenCalled();
  });

  it("returns 400 for prs without exerciseId or exerciseName", async () => {
    const response = await GET(makeRequest("metric=prs"));
    expect(response.status).toBe(400);
    expect(getExercisePRs).not.toHaveBeenCalled();
  });

  it.each(["0", "501"])(
    "returns 400 for out-of-range sessionCount=%s",
    async (sc) => {
      const response = await GET(
        makeRequest(`metric=progression&exerciseId=e1&sessionCount=${sc}`),
      );
      expect(response.status).toBe(400);
      expect(getExerciseProgressionSeries).not.toHaveBeenCalled();
    },
  );

  it("returns 500 when the service throws", async () => {
    vi.mocked(getClientExerciseList).mockRejectedValue(new Error("db down"));

    const response = await GET(makeRequest("metric=list"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ success: false, error: "Failed to fetch exercise history" });
  });
});
