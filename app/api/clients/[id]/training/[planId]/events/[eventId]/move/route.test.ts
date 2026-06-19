import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/services/client-service", () => ({
  getClientById: vi.fn(),
}));

vi.mock("@/services/training-service", () => ({
  getTrainingPlanById: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedCoachId: vi.fn().mockResolvedValue("coach-1"),
}));

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/services/training-event-calendar-service", () => ({
  moveEvent: vi.fn(),
  moveEventAndFuture: vi.fn(),
}));

vi.mock("@/services/nutrition-event-service", () => ({
  cascadeNutritionAfterTrainingChange: vi.fn().mockResolvedValue(undefined),
}));

import { getClientById } from "@/services/client-service";
import { getTrainingPlanById } from "@/services/training-service";
import {
  moveEvent,
  moveEventAndFuture,
} from "@/services/training-event-calendar-service";
import { cascadeNutritionAfterTrainingChange } from "@/services/nutrition-event-service";
import { POST } from "./route";

const clientId = "client-1";
const planId = "plan-1";
const eventId = "event-1";

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(
    `http://localhost/api/clients/${clientId}/training/${planId}/events/${eventId}/move`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

async function callRoute(body: Record<string, unknown>) {
  return POST(makeRequest(body), {
    params: Promise.resolve({ id: clientId, planId, eventId }),
  });
}

describe("POST /api/clients/[id]/training/[planId]/events/[eventId]/move nutrition cascade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getClientById).mockResolvedValue({
      id: clientId,
      coachId: "coach-1",
    } as never);
    vi.mocked(getTrainingPlanById).mockResolvedValue({
      id: planId,
      clientId,
    } as never);
  });

  it("forward-in-time single move cascades from sourceDate (min of source/target)", async () => {
    vi.mocked(moveEvent).mockResolvedValue({
      sourceDate: "2026-04-27",
      targetDate: "2026-04-30",
    });

    const res = await callRoute({ targetDate: "2026-04-30", scope: "single" });

    expect(res.status).toBe(200);
    expect(cascadeNutritionAfterTrainingChange).toHaveBeenCalledTimes(1);
    expect(cascadeNutritionAfterTrainingChange).toHaveBeenCalledWith(
      clientId,
      "2026-04-27",
      "cascade-nutrition-events-from-move"
    );
  });

  it("backward-in-time single move cascades from targetDate", async () => {
    vi.mocked(moveEvent).mockResolvedValue({
      sourceDate: "2026-04-30",
      targetDate: "2026-04-27",
    });

    const res = await callRoute({ targetDate: "2026-04-27", scope: "single" });

    expect(res.status).toBe(200);
    expect(cascadeNutritionAfterTrainingChange).toHaveBeenCalledWith(
      clientId,
      "2026-04-27",
      "cascade-nutrition-events-from-move"
    );
  });

  it("scope=all_future uses earliestSourceDate when it precedes targetDate", async () => {
    vi.mocked(moveEventAndFuture).mockResolvedValue({
      earliestSourceDate: "2026-04-27",
      targetDate: "2026-04-29",
    });

    const res = await callRoute({ targetDate: "2026-04-29", scope: "all_future" });

    expect(res.status).toBe(200);
    expect(moveEventAndFuture).toHaveBeenCalledWith(eventId, "2026-04-29", clientId, planId);
    expect(moveEvent).not.toHaveBeenCalled();
    expect(cascadeNutritionAfterTrainingChange).toHaveBeenCalledWith(
      clientId,
      "2026-04-27",
      "cascade-nutrition-events-from-move"
    );
  });
});
