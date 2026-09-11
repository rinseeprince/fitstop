import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/require-coach-auth", () => ({
  requireCoachOwnsClient: vi.fn(),
}));
vi.mock("@/services/today-service", () => ({
  getClientTodayString: vi.fn().mockResolvedValue("2026-09-11"),
}));
vi.mock("@/services/audit-log-service", () => ({
  recordAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
// The retire path's own statements are proved in
// services/nutrition-plan-clear-service.test.ts; here only that it is fired
// for ONE id, with the client's today, behind the full coach chain.
vi.mock("@/services/nutrition-plan-clear-service", () => ({
  clearNutritionPlanById: vi.fn(),
}));

import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getClientTodayString } from "@/services/today-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { clearNutritionPlanById } from "@/services/nutrition-plan-clear-service";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { DELETE } from "./route";

const params = { params: Promise.resolve({ id: "client-1", planId: "v-run" }) };
const request = () =>
  new NextRequest("http://localhost/api/clients/client-1/nutrition/v-run", { method: "DELETE" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireCoachOwnsClient).mockResolvedValue({ authorized: true, coachId: "coach-1" });
  vi.mocked(getClientTodayString).mockResolvedValue("2026-09-11");
});

describe("DELETE /api/clients/[id]/nutrition/[planId] — the block card's per-plan delete", () => {
  it("ends the one version, with the client's today, and audits it", async () => {
    vi.mocked(clearNutritionPlanById).mockResolvedValue({ outcome: "ended", editsCleared: 2 });

    const response = await DELETE(request(), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: { outcome: "ended", editsCleared: 2 } });
    expect(requireCoachOwnsClient).toHaveBeenCalledWith("client-1", expect.any(NextRequest));
    expect(getClientTodayString).toHaveBeenCalledWith("client-1");
    expect(clearNutritionPlanById).toHaveBeenCalledWith("client-1", "2026-09-11", "v-run");
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "coach-1",
        actorRole: "trainer",
        action: AUDIT_ACTIONS.NUTRITION_PLAN_VERSION_DELETE,
        targetTable: "nutrition_plans",
        targetId: "v-run",
        clientId: "client-1",
        metadata: { outcome: "ended", editsCleared: 2 },
      })
    );
  });

  it("404s a version that is not the client's — or is archived or finished — and audits nothing", async () => {
    vi.mocked(clearNutritionPlanById).mockResolvedValue(null);

    const response = await DELETE(request(), params);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ success: false, error: "Nutrition targets not found" });
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("404s a client the coach does not own before reading anything", async () => {
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Client not found" }, { status: 404 }),
    });

    const response = await DELETE(request(), params);

    expect(response.status).toBe(404);
    expect(clearNutritionPlanById).not.toHaveBeenCalled();
    expect(getClientTodayString).not.toHaveBeenCalled();
  });

  it("a thrown retire is a 500 and audits nothing", async () => {
    vi.mocked(clearNutritionPlanById).mockRejectedValue(new Error("boom"));

    const response = await DELETE(request(), params);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: "Failed to delete nutrition targets" });
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });
});
