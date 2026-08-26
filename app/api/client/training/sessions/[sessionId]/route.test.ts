import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  clientApiRateLimit: vi.fn().mockResolvedValue(null),
  clientPerClientRateLimit: vi.fn().mockResolvedValue(null),
  apiRateLimit: vi.fn().mockResolvedValue(null),
  authRateLimit: vi.fn().mockResolvedValue(null),
  checkInRateLimit: vi.fn().mockResolvedValue(null),
  aiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedClientId: vi.fn(),
}));

vi.mock("@/services/training-service", () => ({
  getSessionWithExercises: vi.fn(),
  getActiveTrainingPlanId: vi.fn(),
}));

import { GET } from "./route";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import {
  getSessionWithExercises,
  getActiveTrainingPlanId,
} from "@/services/training-service";

const CLIENT_ID = "22222222-2222-2222-2222-222222222222";
const SESSION_ID = "33333333-3333-3333-3333-333333333333";
const PLAN_ID = "44444444-4444-4444-4444-444444444444";

function makeRequest(): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/client/training/sessions/${SESSION_ID}`,
    { method: "GET" },
  );
}

function params() {
  return { params: Promise.resolve({ sessionId: SESSION_ID }) };
}

const liveSession = {
  id: SESSION_ID,
  planId: PLAN_ID,
  name: "Pull",
  orderIndex: 0,
  calorieSurplusPercentage: null,
  exercises: [],
  createdAt: "2026-05-01T00:00:00Z",
  updatedAt: "2026-05-01T00:00:00Z",
} as unknown as Awaited<ReturnType<typeof getSessionWithExercises>>;

describe("GET /api/client/training/sessions/[sessionId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(CLIENT_ID);
  });

  it("returns 200 with the session when it belongs to the active plan", async () => {
    vi.mocked(getSessionWithExercises).mockResolvedValue(liveSession);
    vi.mocked(getActiveTrainingPlanId).mockResolvedValue(PLAN_ID);

    const res = await GET(makeRequest(), params());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.session.id).toBe(SESSION_ID);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 404 when the session does not exist", async () => {
    vi.mocked(getSessionWithExercises).mockResolvedValue(null);
    vi.mocked(getActiveTrainingPlanId).mockResolvedValue(PLAN_ID);

    const res = await GET(makeRequest(), params());
    expect(res.status).toBe(404);
  });

  it("returns 404 when the session belongs to a different (non-active) plan", async () => {
    vi.mocked(getSessionWithExercises).mockResolvedValue(liveSession);
    vi.mocked(getActiveTrainingPlanId).mockResolvedValue("other-plan");

    const res = await GET(makeRequest(), params());
    expect(res.status).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(null);
    const res = await GET(makeRequest(), params());
    expect(res.status).toBe(401);
  });
});
