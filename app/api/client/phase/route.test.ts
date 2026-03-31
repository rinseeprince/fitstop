import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET } from "./route";

vi.mock("@/lib/rate-limit", () => ({
  clientApiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedClientId: vi.fn(),
}));

vi.mock("@/services/phase-service", () => ({
  getActivePhase: vi.fn(),
}));

import { clientApiRateLimit } from "@/lib/rate-limit";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { getActivePhase } from "@/services/phase-service";

const mockPhase = {
  id: "phase-1",
  roadmapId: "roadmap-1",
  clientId: "client-1",
  name: "Foundation",
  description: "Build base fitness",
  objectives: "Establish routine",
  orderIndex: 0,
  status: "active" as const,
  startDate: "2024-01-01",
  endDate: "2024-02-01",
  durationWeeks: 4,
  phaseGoalsSnapshot: null,
  milestones: [],
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

function createMockRequest() {
  return new NextRequest("http://localhost:3000/api/client/phase", {
    method: "GET",
  });
}

describe("/api/client/phase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns active phase for authenticated client", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue("client-1");
    vi.mocked(getActivePhase).mockResolvedValue(mockPhase);

    const response = await GET(createMockRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.name).toBe("Foundation");
    expect(data.data.status).toBe("active");
  });

  it("returns null data when no active phase", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue("client-1");
    vi.mocked(getActivePhase).mockResolvedValue(null);

    const response = await GET(createMockRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toBeNull();
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(null);

    const response = await GET(createMockRequest());
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error).toBe("Unauthorized");
  });

  it("respects rate limiting", async () => {
    const rateLimitResponse = NextResponse.json(
      { error: "Rate limited" },
      { status: 429 }
    );
    vi.mocked(clientApiRateLimit).mockResolvedValue(rateLimitResponse);

    const response = await GET(createMockRequest());

    expect(response).toBe(rateLimitResponse);
    expect(getAuthenticatedClientId).not.toHaveBeenCalled();
  });
});
