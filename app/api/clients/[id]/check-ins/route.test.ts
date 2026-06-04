import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET } from "./route";

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/require-coach-auth", () => ({
  requireCoachOwnsClient: vi.fn(),
}));

vi.mock("@/services/check-in-service", () => ({
  getClientCheckIns: vi.fn(),
}));

import { apiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getClientCheckIns } from "@/services/check-in-service";

const mockParams = { params: Promise.resolve({ id: "client-1" }) };

function createMockRequest(query = "") {
  return new NextRequest(
    `http://localhost:3000/api/clients/client-1/check-ins${query}`,
    { method: "GET" }
  );
}

describe("GET /api/clients/[id]/check-ins", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: true,
      coachId: "coach-1",
    } as never);
  });

  it("returns the client's check-ins with a total", async () => {
    vi.mocked(getClientCheckIns).mockResolvedValue({
      checkIns: [{ id: "ci-1" }],
      total: 1,
    } as never);

    const res = await GET(createMockRequest("?limit=20&offset=0"), mockParams);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.checkIns).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(getClientCheckIns).toHaveBeenCalledWith(
      "client-1",
      expect.objectContaining({ limit: 20, offset: 0 })
    );
  });

  it("returns the auth response on ownership failure (403, IDOR)", async () => {
    const forbidden = NextResponse.json(
      { success: false, error: "Forbidden" },
      { status: 403 }
    );
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: false,
      response: forbidden,
    } as never);

    const res = await GET(createMockRequest(), mockParams);

    expect(res.status).toBe(403);
    expect(getClientCheckIns).not.toHaveBeenCalled();
  });

  it("rejects an invalid status filter (400)", async () => {
    const res = await GET(createMockRequest("?status=bogus"), mockParams);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(getClientCheckIns).not.toHaveBeenCalled();
  });
});
