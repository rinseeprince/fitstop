import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/require-client-auth", () => ({
  requireClientAuth: vi.fn(),
}));

vi.mock("@/services/client-day-service", () => ({
  getDaySummary: vi.fn(),
}));

import { GET } from "@/app/api/client/day-summary/route";
import { requireClientAuth } from "@/lib/require-client-auth";
import { getDaySummary } from "@/services/client-day-service";

const mockAuth = vi.mocked(requireClientAuth);
const mockGetDaySummary = vi.mocked(getDaySummary);

function createRequest(date?: string) {
  const url = date
    ? `http://localhost:3000/api/client/day-summary?date=${date}`
    : "http://localhost:3000/api/client/day-summary";
  return new NextRequest(url, { method: "GET" });
}

describe("GET /api/client/day-summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ ok: true, clientId: "client-1" });
    mockGetDaySummary.mockResolvedValue({
      phase: null,
      training: [],
      trainedFor: [],
      nutrition: null,
      wellness: { hasLog: false },
      habits: { totalCount: 0, loggedCount: 0 },
    });
  });

  it("returns 200 with correct shape", async () => {
    mockGetDaySummary.mockResolvedValue({
      phase: null,
      training: [
        {
          eventId: "e1",
          sessionName: "Push",
          sessionFocus: null,
          completionQuality: "full",
          isAlternative: false,
          loggedExerciseCount: 4,
          prescribedExerciseCount: 4,
        },
      ],
      trainedFor: [],
      nutrition: { hasLog: true, caloriesConsumed: 1900, targetCalories: 2000 },
      wellness: { hasLog: true },
      habits: { totalCount: 3, loggedCount: 2 },
    });

    const res = await GET(createRequest("2026-05-08"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.training).toHaveLength(1);
    expect(body.data.nutrition).toEqual({ hasLog: true, caloriesConsumed: 1900, targetCalories: 2000 });
    expect(body.data.wellness).toEqual({ hasLog: true });
    expect(body.data.habits).toEqual({ totalCount: 3, loggedCount: 2 });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 200 for a future date (view-only timeline, no future-bound rejection)", async () => {
    // Far future. The day-summary route must accept this — write-side
    // enforcement (canEditDay) is Session 3.x territory.
    const res = await GET(createRequest("2099-01-01"));

    expect(res.status).toBe(200);
    expect(mockGetDaySummary).toHaveBeenCalledWith("client-1", "2099-01-01");
  });

  it("returns 200 for a date more than 30 days in the past (no past-bound rejection)", async () => {
    // The legacy validateDateParameter capped at 30 days back. The new
    // day-summary endpoint must allow the full timeline.
    const res = await GET(createRequest("2020-01-01"));

    expect(res.status).toBe(200);
    expect(mockGetDaySummary).toHaveBeenCalledWith("client-1", "2020-01-01");
  });

  it("returns 401 when not authenticated", async () => {
    const { NextResponse } = await import("next/server");
    mockAuth.mockResolvedValue({
      ok: false,
      response: NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      ),
    });

    const res = await GET(createRequest("2026-05-08"));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
  });

  it("returns 400 when date parameter is missing", async () => {
    const res = await GET(createRequest());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("date");
  });

  it("returns 400 when date does not match YYYY-MM-DD shape", async () => {
    const res = await GET(createRequest("not-a-date"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("YYYY-MM-DD");
  });

  it("returns 400 when date passes shape but is semantically invalid (month 13)", async () => {
    const res = await GET(createRequest("2026-13-01"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Invalid date");
  });

  it("returns 400 when date passes shape but rolls over (Feb 30)", async () => {
    const res = await GET(createRequest("2026-02-30"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Invalid date");
  });
});
