import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/services/training-event-occupancy", () => ({
  // The route imports this only for the error class; the real module pulls in
  // supabase-admin at load, which has no env in tests.
  DateOccupiedError: class DateOccupiedError extends Error {},
}));

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
}));

import { getClientById } from "@/services/client-service";
import { getTrainingPlanById } from "@/services/training-service";
import { moveEvent } from "@/services/training-event-calendar-service";
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

describe("POST /api/clients/[id]/training/[planId]/events/[eventId]/move", () => {
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
    vi.mocked(moveEvent).mockResolvedValue(undefined);
  });

  it("moves the event and answers 200 — the day's nutrition target follows the session by computation, so the move is the whole write", async () => {
    const res = await callRoute({ targetDate: "2026-04-30" });

    expect(res.status).toBe(200);
    expect(moveEvent).toHaveBeenCalledTimes(1);
    expect(moveEvent).toHaveBeenCalledWith(eventId, "2026-04-30", clientId, planId);
  });

  it("ignores a retired `scope` field rather than rejecting the request", async () => {
    // The scope was deleted from schema and client alike. A browser tab still
    // running the old bundle keeps sending it, and a 400 there would revert the
    // coach's optimistic move with an error they cannot act on. zod strips
    // unrecognised keys, so the drag still lands as the single move it always
    // was — this test is what stops someone "tidying up" by adding .strict().
    const res = await callRoute({ targetDate: "2026-04-29", scope: "all_future" });

    expect(res.status).toBe(200);
    expect(moveEvent).toHaveBeenCalledWith(eventId, "2026-04-29", clientId, planId);
  });

  it("400s a malformed target date without touching the service", async () => {
    const res = await callRoute({ targetDate: "30/04/2026" });

    expect(res.status).toBe(400);
    expect(moveEvent).not.toHaveBeenCalled();
  });
});
