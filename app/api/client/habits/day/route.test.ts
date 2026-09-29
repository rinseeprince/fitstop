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
vi.mock("@/services/client-habit-figures-service", () => ({ getClientHabitDay: vi.fn() }));

import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { getClientHabitDay } from "@/services/client-habit-figures-service";
import { GET } from "./route";

const request = (query: string) => new NextRequest(`http://localhost/api/client/habits/day${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuthenticatedClientId).mockResolvedValue("client-1");
  vi.mocked(getClientHabitDay).mockResolvedValue({ date: "2026-09-29", habits: [] });
});

describe("GET /api/client/habits/day", () => {
  it("reads the authed client's habits on the date, not cached", async () => {
    const response = await GET(request("?date=2026-09-29"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(getClientHabitDay).toHaveBeenCalledWith("client-1", "2026-09-29");
  });

  it("asks for a real date", async () => {
    expect((await GET(request(""))).status).toBe(400);
    expect((await GET(request("?date=2026-02-30"))).status).toBe(400);
    expect(getClientHabitDay).not.toHaveBeenCalled();
  });

  it("reads nothing without a session, and answers a failed read with a 500", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValueOnce(null);
    expect((await GET(request("?date=2026-09-29"))).status).toBe(401);
    vi.mocked(getClientHabitDay).mockRejectedValue(new Error("boom"));
    expect((await GET(request("?date=2026-09-29"))).status).toBe(500);
  });
});
