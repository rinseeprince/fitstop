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
  updateSession: vi.fn(),
  deleteSession: vi.fn(),
  updateSurplusForFutureEvents: vi.fn(),
}));

vi.mock("@/services/training-session-replace-service", () => ({
  replaceSessionFull: vi.fn(),
}));

// The route imports the reader and the error class from here; the real module
// pulls in supabase-admin at load, which has no env in tests. Hoisted so the
// class exists before the mock factory runs, and so the route's `instanceof`
// sees the same class the service mock rejects with.
const { SessionLoggedError } = vi.hoisted(() => ({
  SessionLoggedError: class SessionLoggedError extends Error {},
}));
vi.mock("@/services/training-event-occupancy", () => ({
  getSessionEventLinks: vi.fn(),
  SessionLoggedError,
}));

vi.mock("@/services/nutrition-event-service", () => ({
  cascadeNutritionAfterTrainingChange: vi.fn(),
}));

vi.mock("@/services/today-service", () => ({
  getClientTodayString: vi.fn(),
}));

import { GET, PUT } from "./route";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { getClientById } from "@/services/client-service";
import { getTrainingPlanById } from "@/services/training-service";
import { replaceSessionFull } from "@/services/training-session-replace-service";
import { getSessionEventLinks } from "@/services/training-event-occupancy";
import { cascadeNutritionAfterTrainingChange } from "@/services/nutrition-event-service";
import { getClientTodayString } from "@/services/today-service";

const COACH_ID = "coach-1";
const CLIENT_ID = "11111111-1111-1111-1111-111111111111";
const PLAN_ID = "22222222-2222-2222-2222-222222222222";
const SESSION_ID = "33333333-3333-3333-3333-333333333333";
const TODAY = "2026-07-22";

const mockClient = {
  id: CLIENT_ID,
  coachId: COACH_ID,
  name: "Test Client",
} as unknown as Awaited<ReturnType<typeof getClientById>>;

const mockSession = { id: SESSION_ID, planId: PLAN_ID, name: "Push Day" };

const mockPlan = {
  id: PLAN_ID,
  clientId: CLIENT_ID,
  sessions: [mockSession],
} as unknown as Awaited<ReturnType<typeof getTrainingPlanById>>;

const validBody = {
  name: "Push Day A",
  focus: "Chest",
  estimatedDurationMinutes: 45,
  calorieSurplusPercentage: 15,
  notes: null,
  exercises: [
    {
      name: "Bench Press",
      sets: 3,
      orderIndex: 0,
      setSpecs: [
        { set_number: 1, set_type: "warmup", reps_min: 10, reps_max: 12 },
        { set_number: 2, set_type: "working", reps_min: 5, reps_max: 8 },
      ],
      videoUrl: "https://example.com/bench.mp4",
    },
  ],
};

const replaceResult = {
  session: { id: SESSION_ID, name: "Push Day A", exercises: [] },
  surplusChanged: false,
  identityChanged: true,
  futureEventsUpdated: 2,
  surplusAffectedDates: [],
} as unknown as Awaited<ReturnType<typeof replaceSessionFull>>;

function makeParams() {
  return {
    params: Promise.resolve({ id: CLIENT_ID, planId: PLAN_ID, sessionId: SESSION_ID }),
  };
}

function makeGetRequest(): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/clients/${CLIENT_ID}/training/${PLAN_ID}/sessions/${SESSION_ID}`,
    { method: "GET" },
  );
}

function makePutRequest(body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/clients/${CLIENT_ID}/training/${PLAN_ID}/sessions/${SESSION_ID}`,
    {
      method: "PUT",
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
  vi.mocked(getClientTodayString).mockResolvedValue(TODAY);
});

describe("GET /api/clients/[id]/training/[planId]/sessions/[sessionId]", () => {
  it("returns the session plus its event links and clientToday", async () => {
    const events = [
      { id: "ev-1", date: "2026-07-20", status: "completed", isModified: false },
      { id: "ev-2", date: "2026-07-27", status: "scheduled", isModified: false },
    ];
    vi.mocked(getSessionEventLinks).mockResolvedValue(events);

    const response = await GET(makeGetRequest(), makeParams());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      session: mockSession,
      events,
      clientToday: TODAY,
    });
    expect(getSessionEventLinks).toHaveBeenCalledWith(SESSION_ID, CLIENT_ID);
  });

  it("404s a session that isn't in the plan", async () => {
    vi.mocked(getTrainingPlanById).mockResolvedValue({
      ...(mockPlan as object),
      sessions: [],
    } as unknown as Awaited<ReturnType<typeof getTrainingPlanById>>);

    const response = await GET(makeGetRequest(), makeParams());

    expect(response.status).toBe(404);
    expect(getSessionEventLinks).not.toHaveBeenCalled();
  });
});

describe("PUT /api/clients/[id]/training/[planId]/sessions/[sessionId]", () => {
  it("replaces the session with the client-local today floor and skips the cascade when surplus is unchanged", async () => {
    vi.mocked(replaceSessionFull).mockResolvedValue(replaceResult);

    const response = await PUT(makePutRequest(validBody), makeParams());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      session: replaceResult.session,
      surplusChanged: false,
      identityChanged: true,
      futureEventsUpdated: 2,
    });

    expect(replaceSessionFull).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SESSION_ID,
        planId: PLAN_ID,
        clientId: CLIENT_ID,
        coachId: COACH_ID,
        fromDate: TODAY,
      }),
    );
    // setSpecs/videoUrl must survive validation + the ExerciseInput coercion.
    const input = vi.mocked(replaceSessionFull).mock.calls[0][0].input;
    expect(input.exercises[0]).toEqual(
      expect.objectContaining({
        name: "Bench Press",
        setSpecs: validBody.exercises[0].setSpecs,
        videoUrl: "https://example.com/bench.mp4",
      }),
    );

    expect(cascadeNutritionAfterTrainingChange).not.toHaveBeenCalled();
  });

  it("fires the nutrition cascade over exactly the affected days when the surplus changed", async () => {
    vi.mocked(replaceSessionFull).mockResolvedValue({
      ...(replaceResult as object),
      surplusChanged: true,
      surplusAffectedDates: ["2026-04-23", "2026-04-25"],
    } as unknown as Awaited<ReturnType<typeof replaceSessionFull>>);

    const response = await PUT(makePutRequest(validBody), makeParams());

    expect(response.status).toBe(200);
    expect(cascadeNutritionAfterTrainingChange).toHaveBeenCalledWith(
      CLIENT_ID,
      { kind: "dates", dates: ["2026-04-23", "2026-04-25"] },
      "cascade-nutrition-from-session-full-edit",
    );
  });

  it("400s an invalid body without touching the service", async () => {
    const response = await PUT(
      makePutRequest({ ...validBody, name: "" }),
      makeParams(),
    );

    expect(response.status).toBe(400);
    expect(replaceSessionFull).not.toHaveBeenCalled();
  });

  it("403s a client owned by another coach", async () => {
    vi.mocked(getClientById).mockResolvedValue({
      ...(mockClient as object),
      coachId: "other-coach",
    } as unknown as Awaited<ReturnType<typeof getClientById>>);

    const response = await PUT(makePutRequest(validBody), makeParams());

    expect(response.status).toBe(403);
    expect(replaceSessionFull).not.toHaveBeenCalled();
  });

  it("404s a session that isn't in the plan", async () => {
    vi.mocked(getTrainingPlanById).mockResolvedValue({
      ...(mockPlan as object),
      sessions: [],
    } as unknown as Awaited<ReturnType<typeof getTrainingPlanById>>);

    const response = await PUT(makePutRequest(validBody), makeParams());

    expect(response.status).toBe(404);
    expect(replaceSessionFull).not.toHaveBeenCalled();
  });

  it("maps the service's logged-day lock to a 409 carrying its coach-facing message", async () => {
    vi.mocked(replaceSessionFull).mockRejectedValue(
      new SessionLoggedError(
        "The client logged this session on Fri, Aug 14, so it can no longer be edited",
      ),
    );

    const response = await PUT(makePutRequest(validBody), makeParams());
    const data = await response.json();

    expect(response.status).toBe(409);
    // No raw service error, and the day is named (CONVENTIONS §10).
    expect(data.error).toBe(
      "The client logged this session on Fri, Aug 14, so it can no longer be edited",
    );
    expect(cascadeNutritionAfterTrainingChange).not.toHaveBeenCalled();
  });

  it("maps the service's rest-day rejection to a 400", async () => {
    vi.mocked(replaceSessionFull).mockRejectedValue(
      new Error("Rest days cannot be edited"),
    );

    const response = await PUT(makePutRequest(validBody), makeParams());
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Rest days cannot be edited");
    expect(cascadeNutritionAfterTrainingChange).not.toHaveBeenCalled();
  });
});
