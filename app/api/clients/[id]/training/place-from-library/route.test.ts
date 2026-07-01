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

vi.mock("@/services/library-placement-service", () => ({
  placePlanOnCalendar: vi.fn(),
  placeSessionOnCalendar: vi.fn(),
  placeInlineEditedPlanOnCalendar: vi.fn(),
}));

vi.mock("@/services/phase-service", () => ({
  assertPhaseBelongsToClient: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/today-service", () => ({
  getClientTodayString: vi.fn(),
}));

vi.mock("@/services/nutrition-event-service", () => ({
  cascadeNutritionAfterTrainingChange: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/audit-log-service", () => ({
  recordAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import { getClientById } from "@/services/client-service";
import {
  placePlanOnCalendar,
  placeInlineEditedPlanOnCalendar,
} from "@/services/library-placement-service";
import { assertPhaseBelongsToClient } from "@/services/phase-service";
import { getClientTodayString } from "@/services/today-service";
import { POST } from "./route";

const clientId = "client-1";
const savedPlanId = "11111111-1111-4111-8111-111111111111";
const phaseId = "22222222-2222-4222-8222-222222222222";

const inlinePlanBody = {
  name: "Edited PPL",
  sessions: [
    {
      name: "Push",
      orderIndex: 0,
      isRest: false,
      exercises: [{ name: "Bench", orderIndex: 0, sets: 3 }],
    },
  ],
};

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(
    `http://localhost/api/clients/${clientId}/training/place-from-library`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

async function callRoute(body: Record<string, unknown>) {
  return POST(makeRequest(body), {
    params: Promise.resolve({ id: clientId }),
  });
}

// Fixed past dates: the guard compares request input against the mocked
// client-local today, so assertions can never collide with the host clock.
describe("POST /api/clients/[id]/training/place-from-library start-date guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getClientById).mockResolvedValue({
      id: clientId,
      coachId: "coach-1",
    } as never);
    vi.mocked(getClientTodayString).mockResolvedValue("2026-01-15");
    vi.mocked(placePlanOnCalendar).mockResolvedValue({
      planId: "plan-1",
      sessionsCreated: 3,
      eventsCreated: 12,
    });
  });

  it("rejects a start date before the client's local today", async () => {
    const res = await callRoute({
      type: "plan",
      savedPlanId,
      startDate: "2026-01-14",
    });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe(
      "Start date 2026-01-14 has already passed for this client (their local date is 2026-01-15)."
    );
    expect(getClientTodayString).toHaveBeenCalledWith(clientId);
    expect(placePlanOnCalendar).not.toHaveBeenCalled();
  });

  it("allows a start date equal to the client's local today", async () => {
    const res = await callRoute({
      type: "plan",
      savedPlanId,
      startDate: "2026-01-15",
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(placePlanOnCalendar).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: "2026-01-15",
        clientId,
      })
    );
  });

  it("allows a future start date", async () => {
    const res = await callRoute({
      type: "plan",
      savedPlanId,
      startDate: "2026-01-20",
    });

    expect(res.status).toBe(200);
    expect(placePlanOnCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: "2026-01-20" })
    );
  });
});

describe("POST /api/clients/[id]/training/place-from-library inline + phase guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getClientById).mockResolvedValue({
      id: clientId,
      coachId: "coach-1",
    } as never);
    vi.mocked(getClientTodayString).mockResolvedValue("2026-01-15");
    vi.mocked(assertPhaseBelongsToClient).mockResolvedValue(undefined);
    vi.mocked(placePlanOnCalendar).mockResolvedValue({
      planId: "plan-1",
      sessionsCreated: 3,
      eventsCreated: 12,
    });
    vi.mocked(placeInlineEditedPlanOnCalendar).mockResolvedValue({
      planId: "inline-plan-1",
      sessionsCreated: 1,
      eventsCreated: 5,
    });
  });

  it("places an edited working copy inline and does not touch the saved-plan path", async () => {
    const res = await callRoute({
      type: "inline",
      plan: inlinePlanBody,
      startDate: "2026-01-20",
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.planId).toBe("inline-plan-1");
    expect(placeInlineEditedPlanOnCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ clientId, startDate: "2026-01-20" }),
    );
    expect(placePlanOnCalendar).not.toHaveBeenCalled();
  });

  it("rejects an inline apply with a foreign phaseId (IDOR)", async () => {
    vi.mocked(assertPhaseBelongsToClient).mockRejectedValue(
      new Error("Phase not found for this client"),
    );

    const res = await callRoute({
      type: "inline",
      plan: inlinePlanBody,
      startDate: "2026-01-20",
      phaseId,
    });

    expect(res.status).toBe(404);
    expect(placeInlineEditedPlanOnCalendar).not.toHaveBeenCalled();
  });

  it("rejects a saved-plan apply with a foreign phaseId (pre-existing IDOR, now closed)", async () => {
    vi.mocked(assertPhaseBelongsToClient).mockRejectedValue(
      new Error("Phase not found for this client"),
    );

    const res = await callRoute({
      type: "plan",
      savedPlanId,
      startDate: "2026-01-20",
      phaseId,
    });

    expect(res.status).toBe(404);
    expect(placePlanOnCalendar).not.toHaveBeenCalled();
  });

  it("re-runs the past-date guard on the inline branch (before the phase check)", async () => {
    const res = await callRoute({
      type: "inline",
      plan: inlinePlanBody,
      startDate: "2026-01-14",
    });

    expect(res.status).toBe(400);
    expect(assertPhaseBelongsToClient).not.toHaveBeenCalled();
    expect(placeInlineEditedPlanOnCalendar).not.toHaveBeenCalled();
  });
});
