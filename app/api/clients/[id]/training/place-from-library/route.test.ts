import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/services/training-event-occupancy", () => ({
  // The route imports this only for the error class; the real module pulls in
  // supabase-admin at load, which has no env in tests.
  DateOccupiedError: class DateOccupiedError extends Error {},
  hasCompletedWorkoutOn: vi.fn().mockResolvedValue(false),
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

vi.mock("@/services/library-placement-service", () => ({
  placePlanOnCalendar: vi.fn(),
  placeSessionOnCalendar: vi.fn(),
  placeInlineEditedPlanOnCalendar: vi.fn(),
  // The route branches on this class; a plain mock would leave `instanceof`
  // comparing against undefined.
  PlacementSupersedeError: class PlacementSupersedeError extends Error {},
}));

vi.mock("@/services/coach-saved-plan-service", () => ({
  getSavedPlanFirstSlotIsRest: vi.fn().mockResolvedValue(false),
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
import { getClientTodayString } from "@/services/today-service";
import { hasCompletedWorkoutOn } from "@/services/training-event-occupancy";
import { getSavedPlanFirstSlotIsRest } from "@/services/coach-saved-plan-service";
import { cascadeNutritionAfterTrainingChange } from "@/services/nutrition-event-service";
import { PlacementSupersedeError } from "@/services/library-placement-service";
import { POST } from "./route";

const clientId = "client-1";
const savedPlanId = "11111111-1111-4111-8111-111111111111";

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
      supersededThrough: null,
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

  it("warns (409) when the start day already has a completed workout, and places when the coach says start anyway", async () => {
    vi.mocked(hasCompletedWorkoutOn).mockResolvedValueOnce(true);
    const warned = await callRoute({ type: "plan", savedPlanId, startDate: "2026-01-15" });
    expect(warned.status).toBe(409);
    expect((await warned.json()).error).toBe("start_day_has_completed_workout");
    expect(placePlanOnCalendar).not.toHaveBeenCalled();

    // startAnyway skips the check entirely (no second query), so nothing is
    // queued here — a leftover mockResolvedValueOnce would leak into the next test.
    const forced = await callRoute({ type: "plan", savedPlanId, startDate: "2026-01-15", startAnyway: true });
    expect(forced.status).toBe(200);
    expect(hasCompletedWorkoutOn).toHaveBeenCalledTimes(1);
    expect(placePlanOnCalendar).toHaveBeenCalledTimes(1);
  });

  it("does not warn when the program's first slot is a rest day (nothing lands on the start day)", async () => {
    vi.mocked(hasCompletedWorkoutOn).mockResolvedValueOnce(true);
    vi.mocked(getSavedPlanFirstSlotIsRest).mockResolvedValueOnce(true);
    const res = await callRoute({ type: "plan", savedPlanId, startDate: "2026-01-15" });
    expect(res.status).toBe(200);
    expect(placePlanOnCalendar).toHaveBeenCalledTimes(1);
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

describe("POST /api/clients/[id]/training/place-from-library inline", () => {
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
      supersededThrough: null,
    });
    vi.mocked(placeInlineEditedPlanOnCalendar).mockResolvedValue({
      planId: "inline-plan-1",
      sessionsCreated: 1,
      eventsCreated: 5,
      supersededThrough: null,
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

  it("re-runs the past-date guard on the inline branch", async () => {
    const res = await callRoute({
      type: "inline",
      plan: inlinePlanBody,
      startDate: "2026-01-14",
    });

    expect(res.status).toBe(400);
    expect(placeInlineEditedPlanOnCalendar).not.toHaveBeenCalled();
  });
});

describe("the placement supersedes the earlier programs (migration 167)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getClientById).mockResolvedValue({
      id: clientId,
      coachId: "coach-1",
    } as never);
    vi.mocked(getClientTodayString).mockResolvedValue("2026-01-15");
  });

  it("threads the furthest superseded day into the nutrition cascade as `to` (migration 167)", async () => {
    vi.mocked(placePlanOnCalendar).mockResolvedValue({
      planId: "plan-1",
      sessionsCreated: 3,
      eventsCreated: 12,
      supersededThrough: "2026-03-29",
    });

    const res = await callRoute({ type: "plan", savedPlanId, startDate: "2026-01-15" });

    expect(res.status).toBe(200);
    expect(cascadeNutritionAfterTrainingChange).toHaveBeenCalledWith(
      clientId,
      { kind: "from", from: "2026-01-15", to: "2026-03-29" },
      expect.any(String)
    );
  });

  it("a supersede failure is a 500 carrying the service's own sentence — the program IS on the calendar", async () => {
    vi.mocked(placePlanOnCalendar).mockRejectedValue(
      new PlacementSupersedeError(
        "The program is on the calendar, but the previous program's sessions from 2026-01-15 could not be removed (boom). Delete them from the calendar, or place the program again."
      )
    );

    const res = await callRoute({ type: "plan", savedPlanId, startDate: "2026-01-15" });
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toMatch(/^The program is on the calendar/);
    expect(cascadeNutritionAfterTrainingChange).not.toHaveBeenCalled();
  });
});
