import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
vi.mock("@/services/client-service", () => ({
  getClientById: vi.fn(),
}));

import { GET } from "./route";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { getClientById } from "@/services/client-service";

const CLIENT_ID = "22222222-2222-2222-2222-222222222222";

function request(): NextRequest {
  return new NextRequest("http://localhost:3000/api/client/check-in-status", {
    method: "GET",
  });
}

function mockClient(overrides: Record<string, unknown> = {}) {
  vi.mocked(getClientById).mockResolvedValue({
    id: CLIENT_ID,
    timezone: "UTC",
    checkInFrequency: "weekly",
    nextCheckInDue: "2026-06-14",
    ...overrides,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuthenticatedClientId).mockResolvedValue(CLIENT_ID);
  mockClient();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * THE REACT NATIVE CONTRACT. The mobile client reads `status` and `nextDueDate`
 * off this route; the shape must not change even as the internals do. The gate
 * is deliberately NOT mocked here — it is a pure function of the client record,
 * so mocking it would leave the wire values themselves untested.
 */
describe("GET /api/client/check-in-status", () => {
  it.each([
    ["2026-06-12", "not_due"],
    ["2026-06-14", "available"],
    ["2026-06-15", "overdue"],
  ])(
    "on %s returns 200 with status=%s and the stored due date",
    async (today, status) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(today + "T12:00:00Z"));

      const response = await GET(request());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        success: true,
        data: { status, nextDueDate: "2026-06-14" },
      });
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    },
  );

  it("returns status=unscheduled with a null date when the client has no schedule", async () => {
    // Still 200 — this route always answers. The card renders "Not scheduled"
    // and drops its link, because there is nothing to check in for.
    mockClient({ nextCheckInDue: undefined });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ status: "unscheduled", nextDueDate: null });
  });

  it("gates on the CLIENT's local today, not server UTC (London 23:30Z boundary)", async () => {
    // 23:30 UTC on 13 June is 00:30 on the 14th in London (BST) — the due day
    // has arrived for the client while the server still reads the 13th.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T23:30:00Z"));
    mockClient({ timezone: "Europe/London" });

    const body = await (await GET(request())).json();

    expect(body.data.status).toBe("available");
  });

  it("answers from the client record alone, with no check-in history read", async () => {
    // A history read here is exactly how the schedule used to reach backwards
    // over a moved check-in day and report a client overdue for a deadline that
    // never existed. This route now issues ONE query.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T12:00:00Z"));

    await GET(request());

    expect(getClientById).toHaveBeenCalledTimes(1);
    expect(getClientById).toHaveBeenCalledWith(CLIENT_ID);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
  });

  it("returns 404 when the client is not found", async () => {
    vi.mocked(getClientById).mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(404);
  });
});
