import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/services/client-service", () => ({
  getClientById: vi.fn(),
}));

vi.mock("@/services/plan-amendment-service", () => {
  class AmendmentConflictError extends Error {}
  class AmendmentValidationError extends Error {}
  class AmendmentEmptyFutureError extends AmendmentValidationError {}
  return {
    getPlacedPlanForBuilder: vi.fn(),
    amendPlacedPlanFuture: vi.fn(),
    AmendmentConflictError,
    AmendmentValidationError,
    AmendmentEmptyFutureError,
  };
});

vi.mock("@/services/nutrition-event-service", () => ({
  cascadeNutritionAfterTrainingChange: vi.fn(),
}));

vi.mock("@/services/audit-log-service", () => ({
  recordAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedCoachId: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));

import { getClientById } from "@/services/client-service";
import {
  getPlacedPlanForBuilder,
  amendPlacedPlanFuture,
  AmendmentConflictError,
  AmendmentEmptyFutureError,
} from "@/services/plan-amendment-service";
import { cascadeNutritionAfterTrainingChange } from "@/services/nutrition-event-service";
import { recordAuditEvent } from "@/services/audit-log-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { GET, PUT } from "./route";

const clientId = "client-1";
const planId = "plan-1";

// A canonical 1-week grid (min the schema accepts).
const validSessions = Array.from({ length: 7 }, (_, i) => ({
  name: i === 0 ? "Push" : "Rest",
  focus: null,
  orderIndex: i,
  weekIndex: 0,
  isRest: i !== 0,
  exercises: i === 0 ? [{ name: "Bench", orderIndex: 0, sets: 3 }] : [],
}));

const validBody = {
  sessions: validSessions,
  expectedToken: "token-abc",
};

function makeGet(): NextRequest {
  return new NextRequest(
    `http://localhost/api/clients/${clientId}/training/${planId}/amendment`,
  );
}

function makePut(body: Record<string, unknown>): NextRequest {
  return new NextRequest(
    `http://localhost/api/clients/${clientId}/training/${planId}/amendment`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

const routeParams = { params: Promise.resolve({ id: clientId, planId }) };

const amendResult = {
  planId,
  floor: "2026-07-22",
  offset: 7,
  sessionsCreated: 3,
  eventsCreated: 3,
  deactivatedSessions: 6,
};

describe("GET /api/clients/[id]/training/[planId]/amendment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue("coach-1");
    vi.mocked(getClientById).mockResolvedValue({ id: clientId, coachId: "coach-1" } as never);
  });

  it("401s without a coach session", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(null);
    const res = await GET(makeGet(), routeParams);
    expect(res.status).toBe(401);
    expect(getPlacedPlanForBuilder).not.toHaveBeenCalled();
  });

  it("403s for another coach's client", async () => {
    vi.mocked(getClientById).mockResolvedValue({ id: clientId, coachId: "coach-2" } as never);
    const res = await GET(makeGet(), routeParams);
    expect(res.status).toBe(403);
    expect(getPlacedPlanForBuilder).not.toHaveBeenCalled();
  });

  it("404s when the plan doesn't belong to the client", async () => {
    vi.mocked(getPlacedPlanForBuilder).mockResolvedValue(null);
    const res = await GET(makeGet(), routeParams);
    expect(res.status).toBe(404);
  });

  it("returns the reader payload", async () => {
    vi.mocked(getPlacedPlanForBuilder).mockResolvedValue({
      plan: { id: planId, name: "PPL Block" },
      clientToday: "2026-07-22",
      windowEnd: "2026-07-28",
      isFullyPast: false,
      amendmentToken: "token-abc",
      sessions: [],
      futureModifiedEvents: [],
    } as never);

    const res = await GET(makeGet(), routeParams);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.amendmentToken).toBe("token-abc");
    expect(getPlacedPlanForBuilder).toHaveBeenCalledWith(clientId, planId);
  });
});

describe("PUT /api/clients/[id]/training/[planId]/amendment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue("coach-1");
    vi.mocked(getClientById).mockResolvedValue({ id: clientId, coachId: "coach-1" } as never);
    vi.mocked(requireCSRFProtection).mockResolvedValue(null as never);
    vi.mocked(amendPlacedPlanFuture).mockResolvedValue(amendResult);
    vi.mocked(cascadeNutritionAfterTrainingChange).mockResolvedValue(undefined);
  });

  it("runs the CSRF check", async () => {
    await PUT(makePut(validBody), routeParams);
    expect(requireCSRFProtection).toHaveBeenCalled();
  });

  it("401s without a coach session", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(null);
    const res = await PUT(makePut(validBody), routeParams);
    expect(res.status).toBe(401);
    expect(amendPlacedPlanFuture).not.toHaveBeenCalled();
  });

  it("403s for another coach's client", async () => {
    vi.mocked(getClientById).mockResolvedValue({ id: clientId, coachId: "coach-2" } as never);
    const res = await PUT(makePut(validBody), routeParams);
    expect(res.status).toBe(403);
    expect(amendPlacedPlanFuture).not.toHaveBeenCalled();
  });

  it("400s an invalid body (missing token)", async () => {
    const res = await PUT(makePut({ sessions: validSessions }), routeParams);
    expect(res.status).toBe(400);
    expect(amendPlacedPlanFuture).not.toHaveBeenCalled();
  });

  it("400s a grid below one whole week", async () => {
    const res = await PUT(
      makePut({ ...validBody, sessions: validSessions.slice(0, 3) }),
      routeParams,
    );
    expect(res.status).toBe(400);
  });

  it("passes sessions, patch, and token through to the writer", async () => {
    const res = await PUT(
      makePut({ ...validBody, plan: { name: "Renamed" } }),
      routeParams,
    );
    expect(res.status).toBe(200);
    expect(amendPlacedPlanFuture).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId,
        coachId: "coach-1",
        planId,
        planPatch: { name: "Renamed" },
        expectedToken: "token-abc",
        sessions: expect.arrayContaining([expect.objectContaining({ name: "Push" })]),
      }),
    );
  });

  it("cascades nutrition anchored at the amendment floor", async () => {
    await PUT(makePut(validBody), routeParams);
    expect(cascadeNutritionAfterTrainingChange).toHaveBeenCalledWith(
      clientId,
      { kind: "from", from: "2026-07-22" },
      "cascade-nutrition-from-plan-amendment",
    );
  });

  it("records the audit event", async () => {
    await PUT(makePut(validBody), routeParams);
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "coach-1",
        actorRole: "trainer",
        action: "training_plan.amend",
        targetTable: "training_plans",
        targetId: planId,
        clientId,
      }),
    );
  });

  it("maps a token conflict to 409", async () => {
    vi.mocked(amendPlacedPlanFuture).mockRejectedValue(
      new AmendmentConflictError("This plan changed while you were editing"),
    );
    const res = await PUT(makePut(validBody), routeParams);
    const data = await res.json();
    expect(res.status).toBe(409);
    expect(data.error).toBe("This plan changed while you were editing");
    expect(cascadeNutritionAfterTrainingChange).not.toHaveBeenCalled();
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("maps a non-canonical/empty-future rejection to 422", async () => {
    vi.mocked(amendPlacedPlanFuture).mockRejectedValue(
      new AmendmentEmptyFutureError("The amendment removes every remaining day of the plan"),
    );
    const res = await PUT(makePut(validBody), routeParams);
    expect(res.status).toBe(422);
  });

  it("maps a missing plan to 404", async () => {
    vi.mocked(amendPlacedPlanFuture).mockRejectedValue(new Error("Plan not found"));
    const res = await PUT(makePut(validBody), routeParams);
    expect(res.status).toBe(404);
  });

  it("500s without echoing an unexpected error's message", async () => {
    vi.mocked(amendPlacedPlanFuture).mockRejectedValue(
      new Error('violates check constraint "training_plans_frequency_check"'),
    );
    const res = await PUT(makePut(validBody), routeParams);
    const data = await res.json();
    expect(res.status).toBe(500);
    expect(data.error).toBe("Failed to save plan changes");
  });
});
