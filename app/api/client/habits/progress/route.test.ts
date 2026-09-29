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
vi.mock("@/services/client-habit-figures-service", () => ({ getClientHabitProgress: vi.fn() }));

import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { getClientHabitProgress } from "@/services/client-habit-figures-service";
import { HABIT_PROGRESS_WEEKS_DEFAULT, HABIT_PROGRESS_WEEKS_MAX } from "@/lib/constants";
import { GET } from "./route";

const request = (query = "") => new NextRequest(`http://localhost/api/client/habits/progress${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuthenticatedClientId).mockResolvedValue("client-1");
  vi.mocked(getClientHabitProgress).mockResolvedValue({ clientToday: "2026-09-30", habits: [] });
});

describe("GET /api/client/habits/progress", () => {
  it("reads the authed client's recent weeks, the default number when none is asked for", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(getClientHabitProgress).toHaveBeenCalledWith("client-1", HABIT_PROGRESS_WEEKS_DEFAULT);
  });

  it("reads the number of weeks asked for, within its bound", async () => {
    await GET(request("?weeks=12"));
    expect(getClientHabitProgress).toHaveBeenCalledWith("client-1", 12);
    for (const weeks of ["0", String(HABIT_PROGRESS_WEEKS_MAX + 1), "2.5", "many"]) {
      expect((await GET(request(`?weeks=${weeks}`))).status).toBe(400);
    }
    expect(getClientHabitProgress).toHaveBeenCalledTimes(1);
  });

  it("reads nothing without a session", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValueOnce(null);
    expect((await GET(request())).status).toBe(401);
    expect(getClientHabitProgress).not.toHaveBeenCalled();
  });
});
