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
import { encodeCursor } from "@/lib/cursor";

const mockParams = { params: Promise.resolve({ id: "client-1" }) };

const CURSOR = {
  createdAt: "2026-05-01T00:00:00.000Z",
  id: "11111111-1111-4111-8111-111111111111",
};

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

  it("pages on a keyset cursor by default, with the first page's exact total", async () => {
    vi.mocked(getClientCheckIns).mockResolvedValue({
      checkIns: [{ id: "ci-1" }],
      total: 22,
      nextCursor: { createdAt: CURSOR.createdAt, id: CURSOR.id },
    } as never);

    const res = await GET(createMockRequest("?limit=20"), mockParams);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.checkIns).toHaveLength(1);
    expect(body.nextCursor).toBe(encodeCursor(CURSOR));
    expect(body.hasMore).toBe(true);
    // The Check-ins tab's rail renders this count.
    expect(body.total).toBe(22);
    expect(getClientCheckIns).toHaveBeenCalledWith("client-1", {
      limit: 20,
      keyset: true,
      cursor: undefined,
      status: undefined,
      withTotal: true,
    });
  });

  it("pages on a valid cursor, and pays for no count past the first page", async () => {
    vi.mocked(getClientCheckIns).mockResolvedValue({
      checkIns: [{ id: "ci-2" }],
      total: 0,
      nextCursor: null,
    } as never);

    const res = await GET(
      createMockRequest(`?limit=20&cursor=${encodeCursor(CURSOR)}`),
      mockParams
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.nextCursor).toBeNull();
    expect(body.hasMore).toBe(false);
    // Absent, not a misleading zero.
    expect(body).not.toHaveProperty("total");
    expect(getClientCheckIns).toHaveBeenCalledWith("client-1", {
      limit: 20,
      keyset: true,
      cursor: CURSOR,
      status: undefined,
      withTotal: false,
    });
  });

  it("rejects a malformed cursor before it reaches the query (400)", async () => {
    const res = await GET(createMockRequest("?cursor=not-a-cursor"), mockParams);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(getClientCheckIns).not.toHaveBeenCalled();
  });

  it("still serves the legacy offset mode when ?offset= is explicit", async () => {
    vi.mocked(getClientCheckIns).mockResolvedValue({
      checkIns: [{ id: "ci-1" }],
      total: 1,
    } as never);

    const res = await GET(createMockRequest("?limit=20&offset=0"), mockParams);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.checkIns).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body).not.toHaveProperty("nextCursor");
    expect(getClientCheckIns).toHaveBeenCalledWith(
      "client-1",
      expect.objectContaining({ limit: 20, offset: 0 })
    );
  });

  it("passes a known status filter through to the service", async () => {
    vi.mocked(getClientCheckIns).mockResolvedValue({
      checkIns: [],
      total: 0,
      nextCursor: null,
    } as never);

    const res = await GET(createMockRequest("?status=reviewed"), mockParams);

    expect(res.status).toBe(200);
    expect(getClientCheckIns).toHaveBeenCalledWith(
      "client-1",
      expect.objectContaining({ status: "reviewed" })
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
