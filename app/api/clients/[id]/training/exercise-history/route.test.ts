import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/require-coach-auth", () => ({
  requireCoachOwnsClient: vi.fn().mockResolvedValue({
    authorized: true,
    coachId: "coach-1",
  }),
}));

vi.mock("@/services/exercise-analytics-service", () => ({
  getClientExerciseList: vi.fn().mockResolvedValue([]),
  getExerciseProgressionSeries: vi.fn().mockResolvedValue([]),
  getExercisePRs: vi.fn().mockResolvedValue([]),
}));

import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import {
  getClientExerciseList,
  getExerciseProgressionSeries,
  getExercisePRs,
} from "@/services/exercise-analytics-service";
import { GET } from "./route";

const CLIENT_ID = "client-1";
const BASE_URL = `http://localhost/api/clients/${CLIENT_ID}/training/exercise-history`;

function makeRequest(url: string) {
  return new NextRequest(new URL(url));
}

function makeParams() {
  return { params: Promise.resolve({ id: CLIENT_ID }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireCoachOwnsClient).mockResolvedValue({
    authorized: true,
    coachId: "coach-1",
  });
});

describe("GET /api/clients/[id]/training/exercise-history", () => {
  it("returns 200 with metric=list", async () => {
    const mockData = [
      { exerciseId: "ex-1", name: "Bench Press", logCount: 5, lastLoggedDate: "2026-04-01" },
    ];
    vi.mocked(getClientExerciseList).mockResolvedValue(mockData);

    const res = await GET(makeRequest(`${BASE_URL}?metric=list`), makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual(mockData);
    expect(getClientExerciseList).toHaveBeenCalledWith(CLIENT_ID);
  });

  it("returns 200 with metric=progression", async () => {
    const mockData = [
      {
        date: "2026-04-01",
        sessionLogId: "sl-1",
        topSetWeight: 100,
        topSetReps: 5,
        estimatedOneRepMax: 116.7,
        totalVolume: 1500,
        topSetRpe: 8,
        prescribedSets: 3,
        actualSets: 3,
        prescribedRepsMin: 5,
        prescribedRepsMax: 8,
      },
    ];
    vi.mocked(getExerciseProgressionSeries).mockResolvedValue(mockData);

    const res = await GET(
      makeRequest(`${BASE_URL}?metric=progression&exerciseId=ex-1&sessionCount=10`),
      makeParams()
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual(mockData);
    expect(getExerciseProgressionSeries).toHaveBeenCalledWith(CLIENT_ID, {
      exerciseId: "ex-1",
      exerciseName: undefined,
      sessionCount: 10,
    });
  });

  it("returns 200 with metric=prs", async () => {
    const mockData = [
      { reps: 5, weight: 120, date: "2026-04-01", isRecent: true },
    ];
    vi.mocked(getExercisePRs).mockResolvedValue(mockData);

    const res = await GET(
      makeRequest(`${BASE_URL}?metric=prs&exerciseId=ex-1`),
      makeParams()
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual(mockData);
    expect(getExercisePRs).toHaveBeenCalledWith(CLIENT_ID, {
      exerciseId: "ex-1",
      exerciseName: undefined,
    });
  });

  it("returns 404 for IDOR violation (coach does not own client)", async () => {
    const { NextResponse } = await import("next/server");
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Client not found" }, { status: 404 }),
    });

    const res = await GET(
      makeRequest(`${BASE_URL}?metric=list`),
      makeParams()
    );

    expect(res.status).toBe(404);
  });

  it("returns 400 when metric is missing", async () => {
    const res = await GET(makeRequest(BASE_URL), makeParams());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
  });

  it("returns 400 when metric is invalid", async () => {
    const res = await GET(
      makeRequest(`${BASE_URL}?metric=invalid`),
      makeParams()
    );

    expect(res.status).toBe(400);
  });

  it("returns 400 when progression metric lacks exerciseId and exerciseName", async () => {
    const res = await GET(
      makeRequest(`${BASE_URL}?metric=progression`),
      makeParams()
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("exerciseId or exerciseName");
  });

  it("returns 400 when prs metric lacks exerciseId and exerciseName", async () => {
    const res = await GET(
      makeRequest(`${BASE_URL}?metric=prs`),
      makeParams()
    );

    expect(res.status).toBe(400);
  });

  it("accepts exerciseName as fallback for progression", async () => {
    vi.mocked(getExerciseProgressionSeries).mockResolvedValue([]);

    const res = await GET(
      makeRequest(`${BASE_URL}?metric=progression&exerciseName=Bench+Press`),
      makeParams()
    );

    expect(res.status).toBe(200);
    expect(getExerciseProgressionSeries).toHaveBeenCalledWith(CLIENT_ID, {
      exerciseId: undefined,
      exerciseName: "Bench Press",
      sessionCount: undefined,
    });
  });

  it("sets Cache-Control: no-store header", async () => {
    const res = await GET(
      makeRequest(`${BASE_URL}?metric=list`),
      makeParams()
    );

    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
