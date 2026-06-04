import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET } from "./route";

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/require-coach-auth", () => ({
  requireCoachOwnsClient: vi.fn(),
}));

vi.mock("@/services/roadmap-service", () => ({
  getArchivedRoadmaps: vi.fn(),
}));

import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getArchivedRoadmaps } from "@/services/roadmap-service";

const mockParams = { params: Promise.resolve({ id: "client-1" }) };

function createMockRequest() {
  return new NextRequest(
    "http://localhost:3000/api/clients/client-1/roadmap/archived",
    { method: "GET" }
  );
}

describe("GET /api/clients/[id]/roadmap/archived", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(coachApiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: true,
      coachId: "coach-1",
    } as never);
  });

  it("returns the client's archived roadmaps", async () => {
    vi.mocked(getArchivedRoadmaps).mockResolvedValue([
      { id: "r-1", status: "archived", phases: [] },
      { id: "r-2", status: "completed", phases: [] },
    ] as never);

    const res = await GET(createMockRequest(), mockParams);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(getArchivedRoadmaps).toHaveBeenCalledWith("client-1");
  });

  it("returns the auth response on ownership failure (403)", async () => {
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
    expect(getArchivedRoadmaps).not.toHaveBeenCalled();
  });
});
