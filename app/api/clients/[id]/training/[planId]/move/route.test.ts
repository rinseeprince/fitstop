import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/services/client-service", () => ({ getClientById: vi.fn() }));

// The refusals carry the service's sentences and the route relays each one, so
// these classes behave as the service's do.
vi.mock("@/services/training-plan-move-service", () => {
  class PlanMoveNotFoundError extends Error {
    constructor() {
      super("Plan not found");
    }
  }
  class PlanMoveRefusedError extends Error {}
  return { moveTrainingPlanStart: vi.fn(), PlanMoveNotFoundError, PlanMoveRefusedError };
});
vi.mock("@/services/training-event-occupancy", () => ({
  DateOccupiedError: class DateOccupiedError extends Error {},
}));
vi.mock("@/services/audit-log-service", () => ({ recordAuditEvent: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ getAuthenticatedCoachId: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ coachApiRateLimit: vi.fn() }));
vi.mock("@/lib/csrf-protection", () => ({ requireCSRFProtection: vi.fn() }));

import { POST } from "./route";
import { getClientById } from "@/services/client-service";
import {
  moveTrainingPlanStart,
  PlanMoveNotFoundError,
  PlanMoveRefusedError,
} from "@/services/training-plan-move-service";
import { DateOccupiedError } from "@/services/training-event-occupancy";
import { recordAuditEvent } from "@/services/audit-log-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { AUDIT_ACTIONS } from "@/lib/constants";

const CLIENT_ID = "c0000000-0000-4000-8000-000000000001";
const PLAN_ID = "a0000000-0000-4000-8000-000000000001";
const COACH_ID = "coach-1";

const params = (planId = PLAN_ID) => ({ params: Promise.resolve({ id: CLIENT_ID, planId }) });

function makePost(body: unknown, raw = false): NextRequest {
  return new NextRequest(`http://localhost/api/clients/${CLIENT_ID}/training/${PLAN_ID}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

const moved = { startsOn: "2026-10-05", endsOn: "2026-10-25", sessionsMoved: 9 };

describe("POST /api/clients/[id]/training/[planId]/move", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(coachApiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(null);
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(COACH_ID);
    vi.mocked(getClientById).mockResolvedValue({ id: CLIENT_ID, coachId: COACH_ID } as never);
    vi.mocked(moveTrainingPlanStart).mockResolvedValue(moved);
  });

  it("moves the program and answers with its new dates", async () => {
    const response = await POST(makePost({ startsOn: "2026-10-05" }), params());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: moved });
    expect(moveTrainingPlanStart).toHaveBeenCalledWith({
      clientId: CLIENT_ID,
      planId: PLAN_ID,
      startsOn: "2026-10-05",
    });
  });

  it("records the move in the audit log, dates only", async () => {
    const request = makePost({ startsOn: "2026-10-05" });
    await POST(request, params());

    expect(recordAuditEvent).toHaveBeenCalledWith({
      actorId: COACH_ID,
      actorRole: "trainer",
      action: AUDIT_ACTIONS.TRAINING_PLAN_MOVE,
      targetTable: "training_plans",
      targetId: PLAN_ID,
      clientId: CLIENT_ID,
      metadata: { startsOn: "2026-10-05", endsOn: "2026-10-25", sessionsMoved: 9 },
      request,
    });
  });

  it("stops at the rate limit before anything else", async () => {
    vi.mocked(coachApiRateLimit).mockResolvedValue(
      NextResponse.json({ error: "Too many requests" }, { status: 429 }) as never
    );
    const response = await POST(makePost({ startsOn: "2026-10-05" }), params());

    expect(response.status).toBe(429);
    expect(requireCSRFProtection).not.toHaveBeenCalled();
    expect(moveTrainingPlanStart).not.toHaveBeenCalled();
  });

  it("refuses a cross-site request before authenticating", async () => {
    vi.mocked(requireCSRFProtection).mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }) as never
    );
    const response = await POST(makePost({ startsOn: "2026-10-05" }), params());

    expect(response.status).toBe(403);
    expect(getAuthenticatedCoachId).not.toHaveBeenCalled();
    expect(moveTrainingPlanStart).not.toHaveBeenCalled();
  });

  it("authenticates the coach with the request", async () => {
    const request = makePost({ startsOn: "2026-10-05" });
    await POST(request, params());
    expect(getAuthenticatedCoachId).toHaveBeenCalledWith(request);
  });

  it("401s without a coach", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(null);
    const response = await POST(makePost({ startsOn: "2026-10-05" }), params());

    expect(response.status).toBe(401);
    expect(moveTrainingPlanStart).not.toHaveBeenCalled();
  });

  it("403s another coach's client and a client that doesn't exist", async () => {
    vi.mocked(getClientById).mockResolvedValue({ id: CLIENT_ID, coachId: "coach-2" } as never);
    expect((await POST(makePost({ startsOn: "2026-10-05" }), params())).status).toBe(403);

    vi.mocked(getClientById).mockResolvedValue(null);
    expect((await POST(makePost({ startsOn: "2026-10-05" }), params())).status).toBe(403);

    expect(moveTrainingPlanStart).not.toHaveBeenCalled();
  });

  it("404s a plan id that isn't one", async () => {
    const response = await POST(makePost({ startsOn: "2026-10-05" }), params("not-a-uuid"));
    expect(response.status).toBe(404);
    expect(moveTrainingPlanStart).not.toHaveBeenCalled();
  });

  it("400s a date that isn't on the calendar, and a body that isn't JSON", async () => {
    expect((await POST(makePost({ startsOn: "2026-02-31" }), params())).status).toBe(400);
    expect((await POST(makePost({}), params())).status).toBe(400);
    expect((await POST(makePost("{not json", true), params())).status).toBe(400);
    expect(moveTrainingPlanStart).not.toHaveBeenCalled();
  });

  it("relays a refusal as 409 in the service's own sentence, and audits nothing", async () => {
    vi.mocked(moveTrainingPlanStart).mockRejectedValue(
      new PlanMoveRefusedError("That would overlap Strength.")
    );
    const response = await POST(makePost({ startsOn: "2026-10-05" }), params());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "That would overlap Strength." });
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("relays a day that already holds a session as 409", async () => {
    vi.mocked(moveTrainingPlanStart).mockRejectedValue(
      new DateOccupiedError("Thu, Oct 22 already has a session")
    );
    const response = await POST(makePost({ startsOn: "2026-10-05" }), params());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Thu, Oct 22 already has a session" });
  });

  it("404s a plan that isn't this client's", async () => {
    vi.mocked(moveTrainingPlanStart).mockRejectedValue(new PlanMoveNotFoundError());
    const response = await POST(makePost({ startsOn: "2026-10-05" }), params());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Plan not found" });
  });

  it("never echoes an unexpected failure's text", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(moveTrainingPlanStart).mockRejectedValue(
      new Error('Failed to move the program: relation "training_events" does not exist')
    );
    const response = await POST(makePost({ startsOn: "2026-10-05" }), params());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to move the program" });
  });
});
