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
vi.mock("@/services/today-service", () => ({
  getClientTodayString: vi.fn(),
}));
vi.mock("@/services/client-journey-service", () => ({
  getClientJourney: vi.fn(),
}));

import { GET } from "./route";
import {
  clientApiRateLimit,
  clientPerClientRateLimit,
} from "@/lib/rate-limit";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { getClientTodayString } from "@/services/today-service";
import { getClientJourney } from "@/services/client-journey-service";
import type { ClientJourney } from "@/types/client-journey";

const CLIENT_ID = "22222222-2222-2222-2222-222222222222";

const JOURNEY: ClientJourney = {
  clientToday: "2026-08-12",
  blocks: [
    {
      id: "block-1",
      name: "Build",
      focus: "Six weeks of volume",
      targetWeightKg: 89,
      startsOn: "2026-08-01",
      endsOn: "2026-09-06",
      weeks: 6,
      state: "current",
      weekOfTotal: { current: 2, total: 6 },
      startWeightKg: 88.1,
      endWeightKg: 88.6,
    },
  ],
  goal: { weightKg: 85, deadline: "2026-12-01" },
  currentWeightKg: 88.6,
  currentBlockNotes: {
    blockId: "block-1",
    notes: [
      { id: "note-1", effectiveOn: "2026-08-05", body: "Dropping calories 200." },
    ],
  },
};

function request(): NextRequest {
  return new NextRequest("http://localhost:3000/api/client/journey", {
    method: "GET",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuthenticatedClientId).mockResolvedValue(CLIENT_ID);
  vi.mocked(getClientTodayString).mockResolvedValue("2026-08-12");
  vi.mocked(getClientJourney).mockResolvedValue(JOURNEY);
});

describe("GET /api/client/journey", () => {
  it("returns the journey payload with no-store, kg values untagged", async () => {
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: JOURNEY });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    // Canonical kg on the wire: no unit fields anywhere in the payload.
    expect(JSON.stringify(body)).not.toMatch(/unit/i);
    expect(getClientJourney).toHaveBeenCalledWith(CLIENT_ID, "2026-08-12");
  });

  it("runs the two rate-limit tiers in the §9 order: IP guard first, per-client after auth", async () => {
    await GET(request());

    const ipTier = vi.mocked(clientApiRateLimit).mock.invocationCallOrder[0];
    const auth = vi.mocked(getAuthenticatedClientId).mock.invocationCallOrder[0];
    const perClient =
      vi.mocked(clientPerClientRateLimit).mock.invocationCallOrder[0];
    expect(ipTier).toBeLessThan(auth);
    expect(auth).toBeLessThan(perClient);
    expect(clientPerClientRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      CLIENT_ID
    );
  });

  it("returns 401 when unauthenticated, before any service read", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(getClientTodayString).not.toHaveBeenCalled();
    expect(getClientJourney).not.toHaveBeenCalled();
  });

  it("resolves today at the route and threads it down (service never derives time)", async () => {
    await GET(request());

    expect(getClientTodayString).toHaveBeenCalledWith(CLIENT_ID);
    expect(getClientJourney).toHaveBeenCalledWith(CLIENT_ID, "2026-08-12");
  });

  it("returns a generic 500 without leaking the raw error", async () => {
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.mocked(getClientJourney).mockRejectedValue(
      new Error("relation check_ins exploded")
    );

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ success: false, error: "Failed to fetch journey" });
    expect(JSON.stringify(body)).not.toContain("exploded");
    consoleSpy.mockRestore();
  });
});
