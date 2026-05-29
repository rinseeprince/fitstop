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
vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedClientId: vi.fn(),
  getAuthenticatedClientWithCheckInDay: vi.fn(),
}));
vi.mock("@/services/daily-context-service", () => {
  type Resource = "nutrition" | "wellness" | "training";
  class NoActivePlanError extends Error {
    readonly resource: Resource;
    constructor(resource: Resource) {
      super(`No active plan for ${resource}`);
      this.name = "NoActivePlanError";
      this.resource = resource;
    }
  }
  return {
    getNutritionForDate: vi.fn(),
    resolvePlanContextForDate: vi.fn(),
    NoActivePlanError,
    assertHasActivePlan: (
      ctx: { phaseId: string | null; nutritionPlanId: string | null; trainingPlanId: string | null },
      resource: Resource
    ) => {
      const id =
        resource === "nutrition"
          ? ctx.nutritionPlanId
          : resource === "training"
            ? ctx.trainingPlanId
            : ctx.phaseId;
      if (id == null) throw new NoActivePlanError(resource);
    },
  };
});
vi.mock("@/services/daily-log-permissions-service", () => ({
  getDayEditState: vi.fn(),
  assertCanEdit: vi.fn(),
}));
vi.mock("@/services/daily-log-card-service", () => ({
  upsertNutritionLog: vi.fn(),
}));

import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { getNutritionForDate, resolvePlanContextForDate } from "@/services/daily-context-service";
import { getDayEditState, assertCanEdit } from "@/services/daily-log-permissions-service";
import { upsertNutritionLog } from "@/services/daily-log-card-service";
import { DayLockedError } from "@/lib/daily-log-permissions";
import { GET, PATCH } from "./route";

const params = (date: string) => ({ params: Promise.resolve({ date }) });
const getReq = () => new NextRequest("http://localhost/api/client/daily-logs/2026-05-21/nutrition");
const patchReq = (body: unknown) =>
  new NextRequest("http://localhost/api/client/daily-logs/2026-05-21/nutrition", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuthenticatedClientId).mockResolvedValue("client-1");
});

describe("GET /api/client/daily-logs/[date]/nutrition", () => {
  it("returns nutrition + editable (200)", async () => {
    vi.mocked(getNutritionForDate).mockResolvedValue({
      consumed: null,
      target: { calories: 2100, proteinG: 160, carbsG: 210, fatG: 65 },
      source: "event",
    } as never);
    vi.mocked(getDayEditState).mockResolvedValue({
      editable: true,
      loggedStatus: "never-logged",
      clientTimezone: "UTC",
    } as never);

    const res = await GET(getReq(), params("2026-05-21"));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.source).toBe("event");
    expect(json.data.editable).toBe(true);
  });

  it("400 on a malformed date", async () => {
    const res = await GET(getReq(), params("not-a-date"));
    expect(res.status).toBe(400);
  });

  it("401 when unauthenticated", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(null);
    const res = await GET(getReq(), params("2026-05-21"));
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/client/daily-logs/[date]/nutrition", () => {
  const happyContext = () => {
    vi.mocked(resolvePlanContextForDate).mockResolvedValue({
      phaseId: "p1",
      nutritionPlanId: "np1",
      trainingPlanId: null,
    } as never);
    vi.mocked(upsertNutritionLog).mockResolvedValue({ id: "log-1" } as never);
  };

  it("201 on a first log", async () => {
    vi.mocked(assertCanEdit).mockResolvedValue({ loggedStatus: "never-logged" } as never);
    happyContext();

    const res = await PATCH(patchReq({ caloriesConsumed: 2000 }), params("2026-05-21"));
    expect(res.status).toBe(201);
    expect(upsertNutritionLog).toHaveBeenCalledWith(
      "client-1",
      "2026-05-21",
      { caloriesConsumed: 2000 },
      { phaseId: "p1", nutritionPlanId: "np1" }
    );
  });

  it("200 when the day is already logged", async () => {
    vi.mocked(assertCanEdit).mockResolvedValue({ loggedStatus: "logged" } as never);
    happyContext();

    const res = await PATCH(patchReq({ caloriesConsumed: 2000 }), params("2026-05-21"));
    expect(res.status).toBe(200);
  });

  it("403 (via assertCanEdit) when the day is locked", async () => {
    vi.mocked(assertCanEdit).mockRejectedValue(new DayLockedError("2026-05-21", "nutrition"));

    const res = await PATCH(patchReq({ caloriesConsumed: 2000 }), params("2026-05-21"));
    expect(res.status).toBe(403);
    expect(upsertNutritionLog).not.toHaveBeenCalled();
  });

  it("400 on an out-of-range value (before any write guard)", async () => {
    const res = await PATCH(patchReq({ caloriesConsumed: 999999 }), params("2026-05-21"));
    expect(res.status).toBe(400);
    expect(assertCanEdit).not.toHaveBeenCalled();
  });

  it("400 on an unknown key (.strict)", async () => {
    const res = await PATCH(patchReq({ bogus: 1 }), params("2026-05-21"));
    expect(res.status).toBe(400);
  });

  it("400 on a malformed date", async () => {
    const res = await PATCH(patchReq({ caloriesConsumed: 2000 }), params("not-a-date"));
    expect(res.status).toBe(400);
  });

  it("401 when unauthenticated", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(null);
    const res = await PATCH(patchReq({ caloriesConsumed: 2000 }), params("2026-05-21"));
    expect(res.status).toBe(401);
  });

  it("422 when no active nutrition plan (orphan log guard)", async () => {
    vi.mocked(assertCanEdit).mockResolvedValue({ loggedStatus: "never-logged" } as never);
    vi.mocked(resolvePlanContextForDate).mockResolvedValue({
      phaseId: "p1",
      nutritionPlanId: null,
      trainingPlanId: null,
    } as never);

    const res = await PATCH(patchReq({ caloriesConsumed: 2000 }), params("2026-05-21"));
    const json = await res.json();
    expect(res.status).toBe(422);
    expect(json).toEqual({ success: false, error: "No active plan for nutrition" });
    expect(upsertNutritionLog).not.toHaveBeenCalled();
  });

  it("500 when the writer throws a non-lock error", async () => {
    vi.mocked(assertCanEdit).mockResolvedValue({ loggedStatus: "never-logged" } as never);
    happyContext();
    vi.mocked(upsertNutritionLog).mockRejectedValue(new Error("boom"));

    const res = await PATCH(patchReq({ caloriesConsumed: 2000 }), params("2026-05-21"));
    expect(res.status).toBe(500);
  });
});
