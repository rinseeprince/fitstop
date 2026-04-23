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
  regenerateFutureNutritionEvents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

vi.mock("@/lib/error-handler", () => ({
  captureApiError: vi.fn(),
}));

import { getClientById } from "@/services/client-service";
import { getTrainingPlanById } from "@/services/training-service";
import {
  moveEvent,
  moveEventAndFuture,
} from "@/services/training-event-calendar-service";
import { regenerateFutureNutritionEvents } from "@/services/nutrition-event-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { POST } from "./route";

const clientId = "client-1";
const planId = "plan-1";
const eventId = "event-1";

type NutritionPlanRow = { id: string; status: "active" | "planned" };

function mockNutritionPlans(rows: NutritionPlanRow[]): void {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockResolvedValue({ data: rows });
  vi.mocked(supabaseAdmin.from).mockReturnValue(chain as never);
}

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

  it("forward-in-time single move cascades from sourceDate", async () => {
    vi.mocked(moveEvent).mockResolvedValue({
      sourceDate: "2026-04-27",
      targetDate: "2026-04-30",
    });
    mockNutritionPlans([{ id: "np-active", status: "active" }]);

    const res = await callRoute({ targetDate: "2026-04-30", scope: "single" });

    expect(res.status).toBe(200);
    expect(regenerateFutureNutritionEvents).toHaveBeenCalledTimes(1);
    expect(regenerateFutureNutritionEvents).toHaveBeenCalledWith(
      clientId,
      "np-active",
      "2026-04-27"
    );
  });

  it("backward-in-time single move cascades from targetDate", async () => {
    vi.mocked(moveEvent).mockResolvedValue({
      sourceDate: "2026-04-30",
      targetDate: "2026-04-27",
    });
    mockNutritionPlans([{ id: "np-active", status: "active" }]);

    const res = await callRoute({ targetDate: "2026-04-27", scope: "single" });

    expect(res.status).toBe(200);
    expect(regenerateFutureNutritionEvents).toHaveBeenCalledWith(
      clientId,
      "np-active",
      "2026-04-27"
    );
  });

  it("scope=all_future uses earliestSourceDate when it precedes targetDate", async () => {
    vi.mocked(moveEventAndFuture).mockResolvedValue({
      earliestSourceDate: "2026-04-27",
      targetDate: "2026-04-29",
    });
    mockNutritionPlans([{ id: "np-active", status: "active" }]);

    const res = await callRoute({ targetDate: "2026-04-29", scope: "all_future" });

    expect(res.status).toBe(200);
    expect(moveEventAndFuture).toHaveBeenCalledWith(eventId, "2026-04-29", clientId, planId);
    expect(moveEvent).not.toHaveBeenCalled();
    expect(regenerateFutureNutritionEvents).toHaveBeenCalledWith(
      clientId,
      "np-active",
      "2026-04-27"
    );
  });

  it("planned nutrition plan is cascaded with undefined fromDate regardless of move direction", async () => {
    vi.mocked(moveEvent).mockResolvedValue({
      sourceDate: "2026-04-27",
      targetDate: "2026-04-30",
    });
    mockNutritionPlans([
      { id: "np-active", status: "active" },
      { id: "np-planned", status: "planned" },
    ]);

    const res = await callRoute({ targetDate: "2026-04-30", scope: "single" });

    expect(res.status).toBe(200);
    expect(regenerateFutureNutritionEvents).toHaveBeenCalledTimes(2);
    expect(regenerateFutureNutritionEvents).toHaveBeenNthCalledWith(
      1,
      clientId,
      "np-active",
      "2026-04-27"
    );
    expect(regenerateFutureNutritionEvents).toHaveBeenNthCalledWith(
      2,
      clientId,
      "np-planned",
      undefined
    );
  });
});
