import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { CheckInGateStatus } from "@/lib/date-helpers";
import { formatDateISO } from "@/lib/date-helpers";

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
vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/date-helpers", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/date-helpers")>()),
  getCheckInStatus: vi.fn(),
}));

import { GET } from "./route";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { getClientById } from "@/services/client-service";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getCheckInStatus } from "@/lib/date-helpers";

const CLIENT_ID = "22222222-2222-2222-2222-222222222222";

function request(): NextRequest {
  return new NextRequest("http://localhost:3000/api/client/check-in-status", { method: "GET" });
}

function mockLastCheckIn(row: unknown) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  };
  vi.mocked(createServerSupabaseClient).mockResolvedValue({
    from: vi.fn().mockReturnValue(query),
  } as never);
}

describe("GET /api/client/check-in-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(CLIENT_ID);
    vi.mocked(getClientById).mockResolvedValue({
      id: CLIENT_ID,
      nextCheckInDue: "2026-06-08", // a Monday
    } as never);
    mockLastCheckIn({ period_end: "2026-05-22", created_at: "2026-05-22T00:00:00Z" });
  });

  it.each<[CheckInGateStatus, string | null]>([
    ["available", "2026-05-29"],
    ["overdue", "2026-05-29"],
    ["completed", "2026-05-29"],
    ["not_due", "2026-05-29"],
  ])("returns 200 with status=%s", async (status, nextDueDate) => {
    vi.mocked(getCheckInStatus).mockReturnValue({
      status,
      nextDueDate: nextDueDate as string,
      periodStart: "2026-05-16",
      periodEnd: "2026-05-22",
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: { status, nextDueDate } });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns status=available with null nextDueDate when no expected day is set", async () => {
    vi.mocked(getClientById).mockResolvedValue({ id: CLIENT_ID } as never);

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ status: "available", nextDueDate: null });
    expect(getCheckInStatus).not.toHaveBeenCalled();
  });

  it("gates on the CLIENT's local today, not server UTC (London 23:30Z boundary)", async () => {
    // 23:30 UTC June 9 = 00:30 BST June 10: the client's check-in day may
    // already have arrived even though the server is still on June 9. (The
    // suite is pinned to TZ=UTC, so a regression to the server clock fails
    // deterministically on any host.)
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-06-09T23:30:00Z"));
      vi.mocked(getClientById).mockResolvedValue({
        id: CLIENT_ID,
        nextCheckInDue: "2026-06-10", // a Wednesday
        timezone: "Europe/London",
      } as never);
      vi.mocked(getCheckInStatus).mockReturnValue({
        status: "available",
        nextDueDate: "2026-06-10",
        periodStart: "2026-06-04",
        periodEnd: "2026-06-10",
      });

      await GET(request());

      const todayArg = vi.mocked(getCheckInStatus).mock.calls[0][2];
      expect(formatDateISO(todayArg)).toBe("2026-06-10");
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(getClientById).not.toHaveBeenCalled();
  });

  it("returns 404 when the client is not found", async () => {
    vi.mocked(getClientById).mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(404);
  });
});
