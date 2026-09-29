import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  aiRateLimit: vi.fn().mockResolvedValue(null),
  apiRateLimit: vi.fn().mockResolvedValue(null),
  authRateLimit: vi.fn().mockResolvedValue(null),
  checkInRateLimit: vi.fn().mockResolvedValue(null),
  clientApiRateLimit: vi.fn().mockResolvedValue(null),
  clientPerClientRateLimit: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/csrf-protection", () => ({ requireCSRFProtection: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedClientId: vi.fn() }));
vi.mock("@/services/client-habit-figures-service", () => {
  class HabitWeekRangeError extends Error {
    constructor() {
      super("The dates must be inside one week.");
    }
  }
  return { HabitWeekRangeError, getClientHabitWeek: vi.fn() };
});

import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { getClientHabitWeek, HabitWeekRangeError } from "@/services/client-habit-figures-service";
import { GET } from "./route";

const request = (query: string) => new NextRequest(`http://localhost/api/client/habits/week${query}`);
const WEEK = { start: "2026-09-28", end: "2026-09-30", dates: [], habits: [], totals: { planned: 0, done: 0, met: 0 } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuthenticatedClientId).mockResolvedValue("client-1");
  vi.mocked(getClientHabitWeek).mockResolvedValue(WEEK);
});

describe("GET /api/client/habits/week", () => {
  it("reads the authed client's habit week over the dates, not cached", async () => {
    const response = await GET(request("?start=2026-09-28&end=2026-09-30"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ success: true, data: WEEK });
    expect(getClientHabitWeek).toHaveBeenCalledWith("client-1", "2026-09-28", "2026-09-30");
  });

  it("asks for a real start and end", async () => {
    expect((await GET(request("?start=2026-09-28"))).status).toBe(400);
    expect((await GET(request("?start=2026-09-28&end=tomorrow"))).status).toBe(400);
    expect(getClientHabitWeek).not.toHaveBeenCalled();
  });

  it("says the dates must be inside one week", async () => {
    vi.mocked(getClientHabitWeek).mockRejectedValue(new HabitWeekRangeError());
    const response = await GET(request("?start=2026-09-28&end=2026-10-06"));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("The dates must be inside one week.");
  });

  it("reads nothing without a session", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValueOnce(null);
    expect((await GET(request("?start=2026-09-28&end=2026-09-30"))).status).toBe(401);
    expect(getClientHabitWeek).not.toHaveBeenCalled();
  });
});
