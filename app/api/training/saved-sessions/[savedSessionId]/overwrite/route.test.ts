import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/services/coach-standalone-session-service", () => ({
  overwriteStandaloneSession: vi.fn(),
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
import { overwriteStandaloneSession } from "@/services/coach-standalone-session-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";

const mockOverwrite = vi.mocked(overwriteStandaloneSession);
const mockAuth = vi.mocked(getAuthenticatedCoachId);

function makeRequest(body: unknown) {
  return new NextRequest(
    "http://localhost/api/training/saved-sessions/s1/overwrite",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

const validBody = {
  name: "Push Day",
  focus: "chest",
  exercises: [{ name: "Bench Press", sets: 3 }],
};

const params = { params: Promise.resolve({ savedSessionId: "s1" }) };

describe("POST /api/training/saved-sessions/[savedSessionId]/overwrite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue("coach-1");
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(makeRequest(validBody), params);
    expect(res.status).toBe(401);
    expect(mockOverwrite).not.toHaveBeenCalled();
  });

  it("returns 400 on an invalid body", async () => {
    const res = await POST(makeRequest({ exercises: [] }), params);
    expect(res.status).toBe(400);
    expect(mockOverwrite).not.toHaveBeenCalled();
  });

  it("overwrites and returns success", async () => {
    mockOverwrite.mockResolvedValue(undefined);
    const res = await POST(makeRequest(validBody), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(mockOverwrite).toHaveBeenCalledWith(
      "s1",
      "coach-1",
      expect.objectContaining({ name: "Push Day" })
    );
  });

  it("maps Session not found to 404", async () => {
    mockOverwrite.mockRejectedValue(new Error("Session not found"));
    const res = await POST(makeRequest(validBody), params);
    expect(res.status).toBe(404);
  });

  it("returns 500 on service failure", async () => {
    mockOverwrite.mockRejectedValue(new Error("boom"));
    const res = await POST(makeRequest(validBody), params);
    expect(res.status).toBe(500);
  });
});
