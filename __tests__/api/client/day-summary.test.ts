import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/require-client-auth", () => ({
  requireClientAuth: vi.fn(),
}));

vi.mock("@/lib/validation-helpers", () => ({
  validateDateParameter: vi.fn().mockReturnValue(null),
}));

vi.mock("@/services/client-day-service", () => ({
  getDaySummary: vi.fn(),
}));

import { GET } from "@/app/api/client/day-summary/route";
import { requireClientAuth } from "@/lib/require-client-auth";
import { getDaySummary } from "@/services/client-day-service";
import { validateDateParameter } from "@/lib/validation-helpers";

const mockAuth = vi.mocked(requireClientAuth);
const mockGetDaySummary = vi.mocked(getDaySummary);
const mockValidateDate = vi.mocked(validateDateParameter);

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
    mockValidateDate.mockReturnValue(null);
    mockGetDaySummary.mockResolvedValue({
      training: [],
      nutrition: null,
      wellness: { hasLog: false },
      habits: { totalCount: 0, loggedCount: 0 },
    });
  });

  it("returns 200 with correct shape", async () => {
    mockGetDaySummary.mockResolvedValue({
      training: [
        {
          eventId: "e1",
          sessionName: "Push",
          sessionFocus: null,
          completionQuality: "full",
          loggedExerciseCount: 4,
          prescribedExerciseCount: 4,
        },
      ],
      nutrition: { hasLog: true },
      wellness: { hasLog: true },
      habits: { totalCount: 3, loggedCount: 2 },
    });

    const res = await GET(createRequest("2026-05-08"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.training).toHaveLength(1);
    expect(body.data.nutrition).toEqual({ hasLog: true });
    expect(body.data.wellness).toEqual({ hasLog: true });
    expect(body.data.habits).toEqual({ totalCount: 3, loggedCount: 2 });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
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

  it("returns 400 when date format is invalid", async () => {
    const { NextResponse } = await import("next/server");
    mockValidateDate.mockReturnValue(
      NextResponse.json(
        { success: false, error: "Invalid date format. Use YYYY-MM-DD" },
        { status: 400 }
      )
    );

    const res = await GET(createRequest("not-a-date"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
  });
});
