import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/services/coach-standalone-session-service", () => ({
  getStandaloneSessions: vi.fn(),
  createStandaloneSession: vi.fn(),
  createStandaloneSessionDeduped: vi.fn(),
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
import {
  createStandaloneSession,
  createStandaloneSessionDeduped,
} from "@/services/coach-standalone-session-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";

const mockCreate = vi.mocked(createStandaloneSession);
const mockCreateDeduped = vi.mocked(createStandaloneSessionDeduped);
const mockAuth = vi.mocked(getAuthenticatedCoachId);

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/training/saved-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/training/saved-sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue("coach-1");
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(makeRequest({ name: "X", exercises: [] }));
    expect(res.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 400 on an invalid body", async () => {
    const res = await POST(makeRequest({ name: "", exercises: [] }));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCreateDeduped).not.toHaveBeenCalled();
  });

  it("creates without dedup by default and echoes the name", async () => {
    mockCreate.mockResolvedValue("s-new");
    const res = await POST(makeRequest({ name: "Push Day", exercises: [] }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      success: true,
      sessionId: "s-new",
      name: "Push Day",
    });
    expect(mockCreate).toHaveBeenCalledWith(
      "coach-1",
      expect.objectContaining({ name: "Push Day" })
    );
    expect(mockCreateDeduped).not.toHaveBeenCalled();
  });

  it("routes dedupeName:true to the deduped create and returns the final name", async () => {
    mockCreateDeduped.mockResolvedValue({
      sessionId: "s-new",
      name: "Push Day (copy)",
    });
    const res = await POST(
      makeRequest({ name: "Push Day", exercises: [], dedupeName: true })
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      success: true,
      sessionId: "s-new",
      name: "Push Day (copy)",
    });
    expect(mockCreate).not.toHaveBeenCalled();
    // The flag is routing metadata, not session data — it never reaches the
    // service input.
    expect(mockCreateDeduped.mock.calls[0][1]).not.toHaveProperty("dedupeName");
  });
});
