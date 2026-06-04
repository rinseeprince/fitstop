import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST } from "./route";

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/require-coach-auth", () => ({
  requireCoachOwnsClient: vi.fn(),
}));

vi.mock("@/services/roadmap-service", () => ({
  getActiveRoadmap: vi.fn(),
  archiveRoadmap: vi.fn(),
}));

import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getActiveRoadmap, archiveRoadmap } from "@/services/roadmap-service";

const mockParams = { params: Promise.resolve({ id: "client-1" }) };

function createMockRequest() {
  return new NextRequest(
    "http://localhost:3000/api/clients/client-1/roadmap/archive",
    { method: "POST" }
  );
}

describe("POST /api/clients/[id]/roadmap/archive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(coachApiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(null);
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: true,
      coachId: "coach-1",
    } as never);
  });

  it("archives the active roadmap and returns it", async () => {
    vi.mocked(getActiveRoadmap).mockResolvedValue({
      id: "roadmap-1",
      phases: [],
    } as never);
    vi.mocked(archiveRoadmap).mockResolvedValue({
      id: "roadmap-1",
      status: "archived",
    } as never);

    const res = await POST(createMockRequest(), mockParams);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("archived");
    expect(archiveRoadmap).toHaveBeenCalledWith("roadmap-1");
  });

  it("returns 404 when there is no active roadmap", async () => {
    vi.mocked(getActiveRoadmap).mockResolvedValue(null);

    const res = await POST(createMockRequest(), mockParams);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
    expect(archiveRoadmap).not.toHaveBeenCalled();
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

    const res = await POST(createMockRequest(), mockParams);

    expect(res.status).toBe(403);
    expect(getActiveRoadmap).not.toHaveBeenCalled();
  });

  it("blocks the request when CSRF validation fails", async () => {
    const csrfFail = NextResponse.json(
      { success: false, error: "CSRF" },
      { status: 403 }
    );
    vi.mocked(requireCSRFProtection).mockResolvedValue(csrfFail);

    const res = await POST(createMockRequest(), mockParams);

    expect(res.status).toBe(403);
    expect(requireCoachOwnsClient).not.toHaveBeenCalled();
  });
});
