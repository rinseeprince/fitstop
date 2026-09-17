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
  CalendarMoveDriftError: class CalendarMoveDriftError extends Error {},
  CalendarMoveNotFoundError: class CalendarMoveNotFoundError extends Error {},
}));

import { getClientById } from "@/services/client-service";
import { getTrainingPlanById } from "@/services/training-service";
import {
  CalendarMoveDriftError,
  CalendarMoveNotFoundError,
  moveEvent,
} from "@/services/training-event-calendar-service";
import { POST } from "./route";

const clientId = "client-1";
const planId = "plan-1";
const eventId = "event-1";
const DRIFT = "This session moved since your calendar loaded. The calendar now shows where it is.";

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
    const res = await callRoute({ targetDate: "2026-04-30", fromDate: "2026-04-27" });

    expect(res.status).toBe(200);
    expect(moveEvent).toHaveBeenCalledTimes(1);
    // The day the calendar loaded the session on reaches the service beside the target.
    expect(moveEvent).toHaveBeenCalledWith(eventId, "2026-04-27", "2026-04-30", clientId, planId);
  });

  it("400s a move without the day the calendar loaded the session on — there is nothing to check it against", async () => {
    const missing = await callRoute({ targetDate: "2026-04-30" });
    expect(missing.status).toBe(400);

    const malformed = await callRoute({ targetDate: "2026-04-30", fromDate: "27/04/2026" });
    expect(malformed.status).toBe(400);

    expect(moveEvent).not.toHaveBeenCalled();
  });

  it("400s a malformed target date without touching the service", async () => {
    const res = await callRoute({ targetDate: "30/04/2026", fromDate: "2026-04-27" });

    expect(res.status).toBe(400);
    expect(moveEvent).not.toHaveBeenCalled();
  });

  it("answers 409 with the sentence when the session moved since the calendar loaded", async () => {
    vi.mocked(moveEvent).mockRejectedValueOnce(new CalendarMoveDriftError(DRIFT));

    const res = await callRoute({ targetDate: "2026-04-30", fromDate: "2026-04-27" });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: DRIFT });
  });

  it("answers 404 'Event not found' for an event that is missing or not this client's", async () => {
    // No existence oracle: the body never says the event belongs to someone else.
    vi.mocked(moveEvent).mockRejectedValueOnce(
      new CalendarMoveNotFoundError("Event does not belong to this client/plan"),
    );

    const res = await callRoute({ targetDate: "2026-04-30", fromDate: "2026-04-27" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Event not found" });
  });

  it("keeps the coach's rule refusals at 400", async () => {
    vi.mocked(moveEvent).mockRejectedValueOnce(new Error("Cannot move event to a past date"));
    let res = await callRoute({ targetDate: "2026-04-30", fromDate: "2026-04-27" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Cannot move event to a past date" });

    vi.mocked(moveEvent).mockRejectedValueOnce(new Error("Only scheduled events can be moved"));
    res = await callRoute({ targetDate: "2026-04-30", fromDate: "2026-04-27" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Only scheduled events can be moved" });
  });
});
