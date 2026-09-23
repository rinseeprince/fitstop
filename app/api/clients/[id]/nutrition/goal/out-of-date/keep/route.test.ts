import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/require-coach-auth", () => ({
  requireCoachOwnsClient: vi.fn(),
}));

vi.mock("@/lib/error-handler", () => ({
  captureApiError: vi.fn(),
}));

vi.mock("@/services/audit-log-service", () => ({
  recordAuditEvent: vi.fn(),
}));

vi.mock("@/services/nutrition-goal-service", () => {
  class NutritionNoticeChangedError extends Error {}
  return { keepNutritionForGoal: vi.fn(), NutritionNoticeChangedError };
});

import { POST } from "./route";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { recordAuditEvent } from "@/services/audit-log-service";
import {
  keepNutritionForGoal,
  NutritionNoticeChangedError,
} from "@/services/nutrition-goal-service";

const VERSION = "5f0c2a8e-3b1d-4c6e-9a7f-2d4b6e8a0c13";
const params = { params: Promise.resolve({ id: "client-8" }) };
const request = (body: unknown) =>
  new NextRequest("http://localhost:3000/api/clients/client-8/nutrition/goal/out-of-date/keep", {
    method: "POST",
    body: JSON.stringify(body),
  });

describe("POST /api/clients/[id]/nutrition/goal/out-of-date/keep — the notice's ×", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(coachApiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(null);
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: true,
      coachId: "coach-8",
    } as never);
    vi.mocked(keepNutritionForGoal).mockResolvedValue(undefined);
  });

  it("keeps the version for the coach who owns the client, and audits it", async () => {
    const response = await POST(request({ versionId: VERSION, fromDay: "2026-10-19" }), params);

    expect(response.status).toBe(200);
    expect(requireCoachOwnsClient).toHaveBeenCalledWith("client-8", expect.any(NextRequest));
    expect(keepNutritionForGoal).toHaveBeenCalledWith("client-8", "coach-8", {
      versionId: VERSION,
      fromDay: "2026-10-19",
    });
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "nutrition_plan.keep_for_goal", clientId: "client-8" })
    );
  });

  it("rate-limits, then checks the origin, before anything else", async () => {
    vi.mocked(coachApiRateLimit).mockResolvedValue(new Response(null, { status: 429 }) as never);
    expect((await POST(request({ versionId: VERSION, fromDay: "2026-10-19" }), params)).status).toBe(429);
    expect(requireCSRFProtection).not.toHaveBeenCalled();

    vi.mocked(coachApiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(new Response(null, { status: 403 }) as never);
    expect((await POST(request({ versionId: VERSION, fromDay: "2026-10-19" }), params)).status).toBe(403);
    expect(requireCoachOwnsClient).not.toHaveBeenCalled();
  });

  it("refuses a client the coach does not own, before keeping anything", async () => {
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: false,
      response: new Response(null, { status: 404 }),
    } as never);

    expect((await POST(request({ versionId: VERSION, fromDay: "2026-10-19" }), params)).status).toBe(404);
    expect(keepNutritionForGoal).not.toHaveBeenCalled();
  });

  it("is 400 without a version id and a real day", async () => {
    expect((await POST(request({ versionId: "v-1", fromDay: "2026-10-19" }), params)).status).toBe(400);
    expect((await POST(request({ versionId: VERSION, fromDay: "2026-02-30" }), params)).status).toBe(400);
    expect((await POST(request(null), params)).status).toBe(400);
    expect(keepNutritionForGoal).not.toHaveBeenCalled();
  });

  it("is 409 when the notice has changed since the coach saw it", async () => {
    vi.mocked(keepNutritionForGoal).mockRejectedValue(new NutritionNoticeChangedError("The notice has changed"));
    expect((await POST(request({ versionId: VERSION, fromDay: "2026-10-19" }), params)).status).toBe(409);
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("is 500 when keeping fails", async () => {
    vi.mocked(keepNutritionForGoal).mockRejectedValue(new Error("db down"));
    expect((await POST(request({ versionId: VERSION, fromDay: "2026-10-19" }), params)).status).toBe(500);
  });
});
