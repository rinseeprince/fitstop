import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/require-client-auth", () => ({
  requireClientAuth: vi.fn(),
}));

vi.mock("@/services/client-program-service", () => ({
  getClientProgram: vi.fn(),
}));

import { GET } from "@/app/api/client/program/route";
import { requireClientAuth } from "@/lib/require-client-auth";
import { getClientProgram } from "@/services/client-program-service";

const mockAuth = vi.mocked(requireClientAuth);
const mockGetProgram = vi.mocked(getClientProgram);

function createRequest() {
  return new NextRequest("http://localhost:3000/api/client/program", {
    method: "GET",
  });
}

describe("GET /api/client/program", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ ok: true, clientId: "client-1" });
    mockGetProgram.mockResolvedValue(null);
  });

  it("returns 200 with program data", async () => {
    mockGetProgram.mockResolvedValue({
      roadmap: {
        id: "r1",
        name: "Strength Block",
        longTermGoal: "Get stronger",
        status: "active",
        startedAt: "2026-04-01",
        targetEndDate: "2026-07-01",
      },
      phases: [
        {
          id: "p1",
          name: "Hypertrophy",
          description: null,
          objectives: null,
          orderIndex: 0,
          status: "active",
          startDate: "2026-04-01",
          endDate: null,
          durationWeeks: 4,
          milestones: [],
        },
      ],
      activePhaseId: "p1",
    });

    const res = await GET(createRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.roadmap.name).toBe("Strength Block");
    expect(body.data.phases).toHaveLength(1);
    expect(body.data.activePhaseId).toBe("p1");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 200 with null when no active roadmap", async () => {
    mockGetProgram.mockResolvedValue(null);

    const res = await GET(createRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toBeNull();
  });

  it("returns 401 when not authenticated", async () => {
    const { NextResponse } = await import("next/server");
    mockAuth.mockResolvedValue({
      ok: false,
      response: NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      ),
    });

    const res = await GET(createRequest());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
  });
});
