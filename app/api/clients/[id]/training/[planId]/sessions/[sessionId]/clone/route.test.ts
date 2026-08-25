import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedCoachId: vi.fn(),
}));

vi.mock("@/services/client-service", () => ({
  getClientById: vi.fn(),
}));

vi.mock("@/services/training-service", () => ({
  getTrainingPlanById: vi.fn(),
}));

vi.mock("@/services/training-session-service", () => ({
  cloneSessionForEvent: vi.fn(),
}));

// The route imports the error class from here; the real module pulls in
// supabase-admin at load, which has no env in tests. Hoisted so the class
// exists before the mock factory runs, and so the route's `instanceof` sees
// the same class the service mock rejects with.
const { SessionLoggedError } = vi.hoisted(() => ({
  SessionLoggedError: class SessionLoggedError extends Error {},
}));
vi.mock("@/services/training-event-occupancy", () => ({ SessionLoggedError }));

import { POST } from "./route";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { getClientById } from "@/services/client-service";
import { getTrainingPlanById } from "@/services/training-service";
import { cloneSessionForEvent } from "@/services/training-session-service";

const COACH_ID = "coach-1";
const CLIENT_ID = "11111111-1111-1111-1111-111111111111";
const PLAN_ID = "22222222-2222-2222-2222-222222222222";
const SESSION_ID = "33333333-3333-3333-3333-333333333333";
const EVENT_ID = "44444444-4444-4444-4444-444444444444";

const mockClient = {
  id: CLIENT_ID,
  coachId: COACH_ID,
  name: "Test Client",
} as unknown as Awaited<ReturnType<typeof getClientById>>;

const mockPlan = {
  id: PLAN_ID,
  clientId: CLIENT_ID,
  sessions: [{ id: SESSION_ID, planId: PLAN_ID, name: "Push Day" }],
} as unknown as Awaited<ReturnType<typeof getTrainingPlanById>>;

const validBody = {
  eventId: EVENT_ID,
  exercises: [{ name: "Bench Press", sets: 3, orderIndex: 0 }],
};

function makeParams() {
  return {
    params: Promise.resolve({ id: CLIENT_ID, planId: PLAN_ID, sessionId: SESSION_ID }),
  };
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/clients/${CLIENT_ID}/training/${PLAN_ID}/sessions/${SESSION_ID}/clone`,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuthenticatedCoachId).mockResolvedValue(COACH_ID);
  vi.mocked(getClientById).mockResolvedValue(mockClient);
  vi.mocked(getTrainingPlanById).mockResolvedValue(mockPlan);
});

describe("POST /api/clients/[id]/training/[planId]/sessions/[sessionId]/clone", () => {
  it("clones the session for the event and returns the new session id", async () => {
    vi.mocked(cloneSessionForEvent).mockResolvedValue("new-session-1");

    const response = await POST(makeRequest(validBody), makeParams());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true, newSessionId: "new-session-1" });
    expect(cloneSessionForEvent).toHaveBeenCalledWith(
      SESSION_ID,
      EVENT_ID,
      CLIENT_ID,
      COACH_ID,
      expect.arrayContaining([expect.objectContaining({ name: "Bench Press" })]),
    );
  });

  it("maps the service's logged-day lock to a 409 carrying its coach-facing message", async () => {
    vi.mocked(cloneSessionForEvent).mockRejectedValue(
      new SessionLoggedError(
        "The client logged this session on Fri, Aug 14, so it can no longer be edited",
      ),
    );

    const response = await POST(makeRequest(validBody), makeParams());
    const data = await response.json();

    expect(response.status).toBe(409);
    // No raw service error, and the day is named (CONVENTIONS §10).
    expect(data.error).toBe(
      "The client logged this session on Fri, Aug 14, so it can no longer be edited",
    );
  });

  it("does not leak any other service error, returning a generic 500", async () => {
    vi.mocked(cloneSessionForEvent).mockRejectedValue(
      new Error('duplicate key value violates unique constraint "some_index"'),
    );

    const response = await POST(makeRequest(validBody), makeParams());
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("Failed to clone session");
  });

  it("403s a client owned by another coach", async () => {
    vi.mocked(getClientById).mockResolvedValue({
      ...(mockClient as object),
      coachId: "other-coach",
    } as unknown as Awaited<ReturnType<typeof getClientById>>);

    const response = await POST(makeRequest(validBody), makeParams());

    expect(response.status).toBe(403);
    expect(cloneSessionForEvent).not.toHaveBeenCalled();
  });

  it("404s a session that isn't in the plan", async () => {
    vi.mocked(getTrainingPlanById).mockResolvedValue({
      ...(mockPlan as object),
      sessions: [],
    } as unknown as Awaited<ReturnType<typeof getTrainingPlanById>>);

    const response = await POST(makeRequest(validBody), makeParams());

    expect(response.status).toBe(404);
    expect(cloneSessionForEvent).not.toHaveBeenCalled();
  });

  it("400s an invalid body without touching the service", async () => {
    const response = await POST(makeRequest({ eventId: "not-a-uuid" }), makeParams());

    expect(response.status).toBe(400);
    expect(cloneSessionForEvent).not.toHaveBeenCalled();
  });
});
