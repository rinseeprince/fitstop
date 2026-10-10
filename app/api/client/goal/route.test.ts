import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  clientApiRateLimit: vi.fn().mockResolvedValue(null),
  clientPerClientRateLimit: vi.fn().mockResolvedValue(null),
  apiRateLimit: vi.fn().mockResolvedValue(null),
  authRateLimit: vi.fn().mockResolvedValue(null),
  checkInRateLimit: vi.fn().mockResolvedValue(null),
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
vi.mock("@/services/client-goal-wire-service", () => ({
  getClientGoalWire: vi.fn(),
}));

import { GET } from "./route";
import {
  clientApiRateLimit,
  clientPerClientRateLimit,
} from "@/lib/rate-limit";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { getClientTodayString } from "@/services/today-service";
import { getClientGoalWire } from "@/services/client-goal-wire-service";
import type { ClientGoalWire } from "@/types/client-goal-wire";

const CLIENT_ID = "22222222-2222-2222-2222-222222222222";

const GOAL: ClientGoalWire = {
  goal: {
    weightKg: 85,
    deadline: "2026-12-01",
    name: "Lose weight",
    type: "lose_weight",
    bodyFatPercentage: null,
    description: null,
    startReadings: { weightKg: 91.2, bodyFatPercentage: null },
  },
};

function request(): NextRequest {
  return new NextRequest("http://localhost:3000/api/client/goal", {
    method: "GET",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuthenticatedClientId).mockResolvedValue(CLIENT_ID);
  vi.mocked(getClientTodayString).mockResolvedValue("2026-08-12");
  vi.mocked(getClientGoalWire).mockResolvedValue(GOAL);
});

describe("GET /api/client/goal", () => {
  it("returns the goal with no-store, kg values untagged", async () => {
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: GOAL });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    // Canonical kg on the wire: no unit fields anywhere in the payload.
    expect(JSON.stringify(body)).not.toMatch(/unit/i);
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
    expect(getClientGoalWire).not.toHaveBeenCalled();
  });

  it("resolves today at the route and hands it down (the service never derives time)", async () => {
    await GET(request());

    expect(getClientTodayString).toHaveBeenCalledWith(CLIENT_ID);
    expect(getClientGoalWire).toHaveBeenCalledWith(CLIENT_ID, "2026-08-12");
  });

  it("returns a generic 500 without leaking the raw error", async () => {
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.mocked(getClientGoalWire).mockRejectedValue(
      new Error("relation client_goals exploded")
    );

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ success: false, error: "Failed to fetch goal" });
    expect(JSON.stringify(body)).not.toContain("exploded");
    consoleSpy.mockRestore();
  });
});
