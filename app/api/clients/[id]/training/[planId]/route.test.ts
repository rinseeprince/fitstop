import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/services/client-service", () => ({ getClientById: vi.fn() }));
vi.mock("@/services/training-service", () => ({
  getTrainingPlanById: vi.fn(),
  updateTrainingPlan: vi.fn(),
}));
vi.mock("@/services/training-event-service", () => ({ cancelFutureEventsForPlan: vi.fn() }));
// The retire rule (running ends yesterday, queued archived) is proved in
// training-plan-clear-service.test.ts; the floor's (today, or tomorrow once a
// workout is logged) in event-deletion-floor.test.ts. Here, that this route
// asks both, for this plan alone.
vi.mock("@/services/training-plan-clear-service", () => ({ retireTrainingPlans: vi.fn() }));
vi.mock("@/services/event-deletion-floor", () => ({ resolveEventDeletionFloor: vi.fn() }));
vi.mock("@/services/today-service", () => ({ getClientTodayString: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedCoachId: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ apiRateLimit: vi.fn() }));
vi.mock("@/lib/csrf-protection", () => ({ requireCSRFProtection: vi.fn() }));

import { DELETE } from "./route";
import { getClientById } from "@/services/client-service";
import { getTrainingPlanById } from "@/services/training-service";
import { cancelFutureEventsForPlan } from "@/services/training-event-service";
import { retireTrainingPlans } from "@/services/training-plan-clear-service";
import { resolveEventDeletionFloor } from "@/services/event-deletion-floor";
import { getClientTodayString } from "@/services/today-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";

const CLIENT_ID = "client-1";
const PLAN_ID = "plan-2";

const call = () =>
  DELETE(
    new NextRequest(`http://localhost/api/clients/${CLIENT_ID}/training/${PLAN_ID}`, { method: "DELETE" }),
    { params: Promise.resolve({ id: CLIENT_ID, planId: PLAN_ID }) }
  );

describe("DELETE /api/clients/[id]/training/[planId] — one program", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(null);
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue("coach-1");
    vi.mocked(getClientById).mockResolvedValue({ id: CLIENT_ID, coachId: "coach-1" } as never);
    vi.mocked(getTrainingPlanById).mockResolvedValue({
      id: PLAN_ID,
      clientId: CLIENT_ID,
      effectiveFrom: "2026-10-05",
      effectiveUntil: "2026-10-18",
    } as never);
    vi.mocked(getClientTodayString).mockResolvedValue("2026-09-16");
    vi.mocked(resolveEventDeletionFloor).mockResolvedValue("2026-09-16");
    vi.mocked(retireTrainingPlans).mockResolvedValue({ ended: [], archived: [PLAN_ID] });
    vi.mocked(cancelFutureEventsForPlan).mockResolvedValue(undefined);
  });

  it("retires this program alone against the client's today", async () => {
    const response = await call();

    expect(response.status).toBe(200);
    expect(retireTrainingPlans).toHaveBeenCalledWith(
      [{ id: PLAN_ID, effective_from: "2026-10-05", effective_until: "2026-10-18" }],
      "2026-09-16"
    );
  });

  it("removes its sessions from the floor: today, while nothing is logged today", async () => {
    await call();

    expect(resolveEventDeletionFloor).toHaveBeenCalledWith(CLIENT_ID, "2026-09-16");
    expect(cancelFutureEventsForPlan).toHaveBeenCalledWith(PLAN_ID, "2026-09-16");
  });

  it("from tomorrow once the client has logged a workout today, so today's log stays", async () => {
    vi.mocked(resolveEventDeletionFloor).mockResolvedValue("2026-09-17");

    await call();

    expect(cancelFutureEventsForPlan).toHaveBeenCalledWith(PLAN_ID, "2026-09-17");
  });

  it("refuses another coach's client, and a plan that isn't this client's", async () => {
    vi.mocked(getClientById).mockResolvedValue({ id: CLIENT_ID, coachId: "coach-2" } as never);
    expect((await call()).status).toBe(403);

    vi.mocked(getClientById).mockResolvedValue({ id: CLIENT_ID, coachId: "coach-1" } as never);
    vi.mocked(getTrainingPlanById).mockResolvedValue({ id: PLAN_ID, clientId: "client-2" } as never);
    expect((await call()).status).toBe(404);

    expect(retireTrainingPlans).not.toHaveBeenCalled();
    expect(cancelFutureEventsForPlan).not.toHaveBeenCalled();
  });

  it("stops at the rate limit and at a cross-site request", async () => {
    const { NextResponse } = await import("next/server");
    vi.mocked(apiRateLimit).mockResolvedValue(NextResponse.json({}, { status: 429 }) as never);
    expect((await call()).status).toBe(429);

    vi.mocked(apiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(NextResponse.json({}, { status: 403 }) as never);
    expect((await call()).status).toBe(403);

    expect(retireTrainingPlans).not.toHaveBeenCalled();
  });
});
