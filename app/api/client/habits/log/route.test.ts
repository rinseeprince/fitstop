import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock the lower auth-chain modules and let the real `requireClientAuth` wrapper compose
// them (codebase convention — no test mocks the wrapper itself).
vi.mock("@/lib/rate-limit", () => ({
  aiRateLimit: vi.fn().mockResolvedValue(null),
  apiRateLimit: vi.fn().mockResolvedValue(null),
  authRateLimit: vi.fn().mockResolvedValue(null),
  checkInRateLimit: vi.fn().mockResolvedValue(null),
  clientApiRateLimit: vi.fn().mockResolvedValue(null),
  clientPerClientRateLimit: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedClientId: vi.fn(),
}));
vi.mock("@/services/daily-log-permissions-service", () => ({
  assertCanEdit: vi.fn(),
  getDayEditState: vi.fn(),
}));
vi.mock("@/services/daily-habits-service", () => ({
  logHabit: vi.fn(),
}));

import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { assertCanEdit } from "@/services/daily-log-permissions-service";
import { logHabit } from "@/services/daily-habits-service";
// Import the REAL error class — the route's `instanceof DayLockedError` must match.
import { DayLockedError } from "@/lib/daily-log-permissions";
import { POST } from "./route";

const UID = "00000000-0000-4000-8000-000000000000";

const postReq = (body: unknown) =>
  new NextRequest("http://localhost/api/client/habits/log", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuthenticatedClientId).mockResolvedValue("client-1");
});

describe("POST /api/client/habits/log", () => {
  it("200 and logs the habit on an editable day (asserting per-habit lock check)", async () => {
    vi.mocked(assertCanEdit).mockResolvedValue({ loggedStatus: "never-logged" } as never);
    vi.mocked(logHabit).mockResolvedValue({
      id: "log-1",
      dailyHabitId: UID,
      completed: true,
    } as never);

    const res = await POST(postReq({ dailyHabitId: UID, date: "2026-05-21", completed: true }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(assertCanEdit).toHaveBeenCalledWith({
      clientId: "client-1",
      date: "2026-05-21",
      resourceType: "habit",
      habitId: UID,
    });
    expect(logHabit).toHaveBeenCalledWith(UID, "client-1", "2026-05-21", true, undefined);
  });

  it("403 when the day is locked (assertCanEdit throws DayLockedError)", async () => {
    vi.mocked(assertCanEdit).mockRejectedValue(new DayLockedError("2026-05-21", "habit"));

    const res = await POST(postReq({ dailyHabitId: UID, date: "2026-05-21", completed: true }));
    expect(res.status).toBe(403);
    expect(logHabit).not.toHaveBeenCalled();
  });

  it("400 on a malformed date — schema is format-only", async () => {
    const res = await POST(postReq({ dailyHabitId: UID, date: "21-05-2026", completed: true }));
    expect(res.status).toBe(400);
    expect(assertCanEdit).not.toHaveBeenCalled();
    expect(logHabit).not.toHaveBeenCalled();
  });

  it("future dates pass the schema and are judged by the client-tz lock guard, not the server clock", async () => {
    // The schema must NOT bound dates against the server clock: an east-of-UTC
    // client's own today reads as "future" in UTC. Day bounds belong to
    // assertCanEdit (canEditDay), which resolves today in the client's timezone.
    vi.mocked(assertCanEdit).mockRejectedValue(new DayLockedError("2999-01-01", "habit"));

    const res = await POST(postReq({ dailyHabitId: UID, date: "2999-01-01", completed: true }));
    expect(res.status).toBe(403);
    expect(assertCanEdit).toHaveBeenCalledWith({
      clientId: "client-1",
      date: "2999-01-01",
      resourceType: "habit",
      habitId: UID,
    });
    expect(logHabit).not.toHaveBeenCalled();
  });

  it("401 when unauthenticated", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(null);
    const res = await POST(postReq({ dailyHabitId: UID, date: "2026-05-21", completed: true }));
    expect(res.status).toBe(401);
    expect(assertCanEdit).not.toHaveBeenCalled();
  });

  it("400 on a non-UUID habit id", async () => {
    const res = await POST(
      postReq({ dailyHabitId: "not-a-uuid", date: "2026-05-21", completed: true }),
    );
    expect(res.status).toBe(400);
    expect(assertCanEdit).not.toHaveBeenCalled();
  });

  it("404 when the habit is not owned (logHabit throws 'not found'), after the lock passes", async () => {
    vi.mocked(assertCanEdit).mockResolvedValue({ loggedStatus: "never-logged" } as never);
    vi.mocked(logHabit).mockRejectedValue(new Error("Habit not found or access denied"));

    const res = await POST(postReq({ dailyHabitId: UID, date: "2026-05-21", completed: true }));
    expect(res.status).toBe(404);
  });
});
