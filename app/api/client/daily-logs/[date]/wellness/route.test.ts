import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  aiRateLimit: vi.fn().mockResolvedValue(null),
  apiRateLimit: vi.fn().mockResolvedValue(null),
  authRateLimit: vi.fn().mockResolvedValue(null),
  checkInRateLimit: vi.fn().mockResolvedValue(null),
  clientApiRateLimit: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedClientId: vi.fn(),
  getAuthenticatedClientWithCheckInDay: vi.fn(),
}));
vi.mock("@/services/daily-context-service", () => ({
  resolvePlanContextForDate: vi.fn(),
}));
vi.mock("@/services/daily-logs-service", () => ({
  getTodayLog: vi.fn(),
}));
vi.mock("@/services/daily-log-permissions-service", () => ({
  getDayEditState: vi.fn(),
  assertCanEdit: vi.fn(),
}));
vi.mock("@/services/daily-log-card-service", () => ({
  upsertWellnessLog: vi.fn(),
}));

import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { resolvePlanContextForDate } from "@/services/daily-context-service";
import { getTodayLog } from "@/services/daily-logs-service";
import { getDayEditState, assertCanEdit } from "@/services/daily-log-permissions-service";
import { upsertWellnessLog } from "@/services/daily-log-card-service";
import { DayLockedError } from "@/lib/daily-log-permissions";
import { GET, PATCH } from "./route";

const params = (date: string) => ({ params: Promise.resolve({ date }) });
const getReq = () => new NextRequest("http://localhost/api/client/daily-logs/2026-05-21/wellness");
const patchReq = (body: unknown) =>
  new NextRequest("http://localhost/api/client/daily-logs/2026-05-21/wellness", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuthenticatedClientId).mockResolvedValue("client-1");
});

describe("GET /api/client/daily-logs/[date]/wellness", () => {
  it("returns wellness fields + editable (200)", async () => {
    vi.mocked(getTodayLog).mockResolvedValue({ mood: 4, energy: 7 } as never);
    vi.mocked(getDayEditState).mockResolvedValue({
      editable: true,
      loggedStatus: "logged",
      clientTimezone: "UTC",
    } as never);

    const res = await GET(getReq(), params("2026-05-21"));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data).toEqual({
      mood: 4,
      energy: 7,
      sleep: null,
      stress: null,
      editable: true,
      loggedStatus: "logged",
    });
  });

  it("returns nulls when there is no wellness log", async () => {
    vi.mocked(getTodayLog).mockResolvedValue(null);
    vi.mocked(getDayEditState).mockResolvedValue({
      editable: true,
      loggedStatus: "never-logged",
      clientTimezone: "UTC",
    } as never);

    const res = await GET(getReq(), params("2026-05-21"));
    const json = await res.json();
    expect(json.data.mood).toBeNull();
    expect(json.data.editable).toBe(true);
    expect(json.data.loggedStatus).toBe("never-logged");
  });

  it("401 when unauthenticated", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(null);
    const res = await GET(getReq(), params("2026-05-21"));
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/client/daily-logs/[date]/wellness", () => {
  it("201 on a first log, passing only phaseId to the writer", async () => {
    vi.mocked(assertCanEdit).mockResolvedValue({ loggedStatus: "never-logged" } as never);
    vi.mocked(resolvePlanContextForDate).mockResolvedValue({
      phaseId: "p1",
      nutritionPlanId: "np1",
      trainingPlanId: "tp1",
    } as never);
    vi.mocked(upsertWellnessLog).mockResolvedValue({ id: "log-1" } as never);

    const res = await PATCH(patchReq({ mood: 4, energy: 7 }), params("2026-05-21"));
    expect(res.status).toBe(201);
    expect(upsertWellnessLog).toHaveBeenCalledWith(
      "client-1",
      "2026-05-21",
      { mood: 4, energy: 7 },
      { phaseId: "p1" }
    );
  });

  it("200 when already logged", async () => {
    vi.mocked(assertCanEdit).mockResolvedValue({ loggedStatus: "logged" } as never);
    vi.mocked(resolvePlanContextForDate).mockResolvedValue({
      phaseId: null,
      nutritionPlanId: null,
      trainingPlanId: null,
    } as never);
    vi.mocked(upsertWellnessLog).mockResolvedValue({ id: "log-1" } as never);

    const res = await PATCH(patchReq({ mood: 3 }), params("2026-05-21"));
    expect(res.status).toBe(200);
  });

  it("403 (via assertCanEdit) when the day is locked", async () => {
    vi.mocked(assertCanEdit).mockRejectedValue(new DayLockedError("2026-05-21", "wellness"));
    const res = await PATCH(patchReq({ mood: 3 }), params("2026-05-21"));
    expect(res.status).toBe(403);
    expect(upsertWellnessLog).not.toHaveBeenCalled();
  });

  it("400 on an out-of-range value", async () => {
    const res = await PATCH(patchReq({ mood: 6 }), params("2026-05-21"));
    expect(res.status).toBe(400);
    expect(assertCanEdit).not.toHaveBeenCalled();
  });

  it("400 on a malformed date", async () => {
    const res = await PATCH(patchReq({ mood: 3 }), params("not-a-date"));
    expect(res.status).toBe(400);
  });

  it("500 when the writer throws a non-lock error", async () => {
    vi.mocked(assertCanEdit).mockResolvedValue({ loggedStatus: "never-logged" } as never);
    vi.mocked(resolvePlanContextForDate).mockResolvedValue({
      phaseId: null,
      nutritionPlanId: null,
      trainingPlanId: null,
    } as never);
    vi.mocked(upsertWellnessLog).mockRejectedValue(new Error("boom"));
    const res = await PATCH(patchReq({ mood: 3 }), params("2026-05-21"));
    expect(res.status).toBe(500);
  });
});
