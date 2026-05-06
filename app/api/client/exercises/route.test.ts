import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  clientApiRateLimit: vi.fn().mockResolvedValue(null),
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

vi.mock("@/services/supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

vi.mock("@/services/exercise-catalog-service", () => ({
  getExercisesForCoach: vi.fn(),
}));

import { GET } from "./route";
import { clientApiRateLimit } from "@/lib/rate-limit";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getExercisesForCoach } from "@/services/exercise-catalog-service";

const CLIENT_ID = "22222222-2222-2222-2222-222222222222";
const COACH_ID = "33333333-3333-3333-3333-333333333333";

function makeRequest(search?: string): NextRequest {
  const url = search
    ? `http://localhost:3000/api/client/exercises?search=${encodeURIComponent(search)}`
    : "http://localhost:3000/api/client/exercises";
  return new NextRequest(url, { method: "GET" });
}

function mockClientRow(coachId: string | null) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: coachId ? { coach_id: coachId } : { coach_id: null },
      error: null,
    }),
  };
  vi.mocked(supabaseAdmin.from).mockReturnValue(query as never);
  return query;
}

function mockClientRowError() {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: null,
      error: { message: "not found" },
    }),
  };
  vi.mocked(supabaseAdmin.from).mockReturnValue(query as never);
  return query;
}

const MOCK_EXERCISES = [
  { id: "ex-1", name: "Bench Press", muscle_group: "chest" },
  { id: "ex-2", name: "Bent-over Row", muscle_group: "back" },
];

describe("GET /api/client/exercises", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clientApiRateLimit).mockResolvedValue(null);
  });

  it("returns 200 with exercises for an authenticated client", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(CLIENT_ID);
    mockClientRow(COACH_ID);
    vi.mocked(getExercisesForCoach).mockResolvedValue(MOCK_EXERCISES as never);

    const response = await GET(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true, exercises: MOCK_EXERCISES });
    expect(getExercisesForCoach).toHaveBeenCalledWith(COACH_ID, undefined);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("passes search query to getExercisesForCoach", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(CLIENT_ID);
    mockClientRow(COACH_ID);
    vi.mocked(getExercisesForCoach).mockResolvedValue([MOCK_EXERCISES[0]] as never);

    const response = await GET(makeRequest("bench"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(getExercisesForCoach).toHaveBeenCalledWith(COACH_ID, "bench");
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(null);

    const response = await GET(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(getExercisesForCoach).not.toHaveBeenCalled();
  });

  it("returns rate-limit response when rate limited", async () => {
    const rlResponse = NextResponse.json(
      { error: "Rate limited" },
      { status: 429 },
    );
    vi.mocked(clientApiRateLimit).mockResolvedValue(rlResponse);

    const response = await GET(makeRequest());

    expect(response.status).toBe(429);
    expect(getAuthenticatedClientId).not.toHaveBeenCalled();
    expect(getExercisesForCoach).not.toHaveBeenCalled();
  });

  it("returns 404 when client row is missing", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(CLIENT_ID);
    mockClientRowError();

    const response = await GET(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({
      success: false,
      error: "Client profile not found",
    });
    expect(getExercisesForCoach).not.toHaveBeenCalled();
  });

  it("returns 404 when coach_id is null", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(CLIENT_ID);
    mockClientRow(null);

    const response = await GET(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({
      success: false,
      error: "Client profile not found",
    });
    expect(getExercisesForCoach).not.toHaveBeenCalled();
  });

  it("returns 500 when getExercisesForCoach throws", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(CLIENT_ID);
    mockClientRow(COACH_ID);
    vi.mocked(getExercisesForCoach).mockRejectedValue(new Error("DB error"));

    const response = await GET(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({
      success: false,
      error: "Failed to fetch exercises",
    });
  });
});
