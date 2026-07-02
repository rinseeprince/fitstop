import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/services/coach-standalone-session-service", () => ({
  duplicateStandaloneSession: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedCoachId: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));

import { POST } from "./route";
import { duplicateStandaloneSession } from "@/services/coach-standalone-session-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";

const mockDuplicate = vi.mocked(duplicateStandaloneSession);
const mockAuth = vi.mocked(getAuthenticatedCoachId);

function makeRequest() {
  return new NextRequest(
    "http://localhost/api/training/saved-sessions/s1/duplicate",
    { method: "POST" }
  );
}

const params = { params: Promise.resolve({ savedSessionId: "s1" }) };

describe("POST /api/training/saved-sessions/[savedSessionId]/duplicate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue("coach-1");
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(makeRequest(), params);
    expect(res.status).toBe(401);
    expect(mockDuplicate).not.toHaveBeenCalled();
  });

  it("duplicates and returns the new session id", async () => {
    mockDuplicate.mockResolvedValue("s2");
    const res = await POST(makeRequest(), params);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ success: true, sessionId: "s2" });
    expect(mockDuplicate).toHaveBeenCalledWith("s1", "coach-1");
  });

  it("maps Session not found to 404", async () => {
    mockDuplicate.mockRejectedValue(new Error("Session not found"));
    const res = await POST(makeRequest(), params);
    expect(res.status).toBe(404);
  });

  it("returns 500 on service failure", async () => {
    mockDuplicate.mockRejectedValue(new Error("boom"));
    const res = await POST(makeRequest(), params);
    expect(res.status).toBe(500);
  });
});
