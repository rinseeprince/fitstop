import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

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

vi.mock("@/services/supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

vi.mock("@/services/exercise-catalog-service", () => ({
  getExerciseCatalogDelta: vi.fn(),
}));

import { GET } from "./route";
import { clientApiRateLimit, clientPerClientRateLimit } from "@/lib/rate-limit";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getExerciseCatalogDelta } from "@/services/exercise-catalog-service";

const CLIENT_ID = "22222222-2222-2222-2222-222222222222";
const COACH_ID = "33333333-3333-3333-3333-333333333333";

function makeRequest(since?: string): NextRequest {
  const url = since
    ? `http://localhost:3000/api/client/exercises/catalog?since=${encodeURIComponent(since)}`
    : "http://localhost:3000/api/client/exercises/catalog";
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

// Lean delta rows — 5 columns, the sparse fieldset the service selects (not SELECT *).
const MOCK_DELTA = [
  {
    id: "ex-1",
    name: "Bench Press",
    muscle_group: "chest",
    equipment: "barbell",
    updated_at: "2026-05-01T00:00:00+00:00",
  },
  {
    id: "ex-2",
    name: "Bent-over Row",
    muscle_group: "back",
    equipment: "barbell",
    updated_at: "2026-05-02T00:00:00+00:00",
  },
];

describe("GET /api/client/exercises/catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clientApiRateLimit).mockResolvedValue(null);
    vi.mocked(clientPerClientRateLimit).mockResolvedValue(null);
  });

  it("returns 200 with the full catalog (no since) and no-store cache header", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(CLIENT_ID);
    mockClientRow(COACH_ID);
    vi.mocked(getExerciseCatalogDelta).mockResolvedValue(MOCK_DELTA);

    const response = await GET(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ success: true, exercises: MOCK_DELTA });
    expect(getExerciseCatalogDelta).toHaveBeenCalledWith(COACH_ID, undefined);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    // Sparse fieldset: rows carry only the 5 sync columns, no SELECT * extras.
    expect(Object.keys(data.exercises[0]).sort()).toEqual([
      "equipment",
      "id",
      "muscle_group",
      "name",
      "updated_at",
    ]);
  });

  it("passes a valid since through to the service", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(CLIENT_ID);
    mockClientRow(COACH_ID);
    vi.mocked(getExerciseCatalogDelta).mockResolvedValue([MOCK_DELTA[1]]);

    const since = "2026-05-01T12:00:00+00:00";
    const response = await GET(makeRequest(since));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(getExerciseCatalogDelta).toHaveBeenCalledWith(COACH_ID, since);
  });

  it("treats an empty since as a full resync (no 400)", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(CLIENT_ID);
    mockClientRow(COACH_ID);
    vi.mocked(getExerciseCatalogDelta).mockResolvedValue(MOCK_DELTA);

    const response = await GET(
      new NextRequest(
        "http://localhost:3000/api/client/exercises/catalog?since=",
        { method: "GET" },
      ),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(getExerciseCatalogDelta).toHaveBeenCalledWith(COACH_ID, undefined);
  });

  it("returns 400 for a malformed since and does NOT call the service", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(CLIENT_ID);
    mockClientRow(COACH_ID);

    const response = await GET(makeRequest("not-a-date"));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ success: false, error: "Invalid since" });
    expect(getExerciseCatalogDelta).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(null);

    const response = await GET(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(getExerciseCatalogDelta).not.toHaveBeenCalled();
  });

  it("returns 404 when the client row is missing", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(CLIENT_ID);
    mockClientRowError();

    const response = await GET(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ success: false, error: "Client profile not found" });
    expect(getExerciseCatalogDelta).not.toHaveBeenCalled();
  });

  it("returns 404 when coach_id is null", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(CLIENT_ID);
    mockClientRow(null);

    const response = await GET(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ success: false, error: "Client profile not found" });
    expect(getExerciseCatalogDelta).not.toHaveBeenCalled();
  });

  it("returns the rate-limit response when rate limited", async () => {
    const rlResponse = NextResponse.json(
      { error: "Rate limited" },
      { status: 429 },
    );
    vi.mocked(clientApiRateLimit).mockResolvedValue(rlResponse);

    const response = await GET(makeRequest());

    expect(response.status).toBe(429);
    expect(getAuthenticatedClientId).not.toHaveBeenCalled();
    expect(getExerciseCatalogDelta).not.toHaveBeenCalled();
  });

  it("returns 500 when the service throws", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(CLIENT_ID);
    mockClientRow(COACH_ID);
    vi.mocked(getExerciseCatalogDelta).mockRejectedValue(new Error("DB error"));

    const response = await GET(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({
      success: false,
      error: "Failed to fetch exercise catalog",
    });
  });
});
