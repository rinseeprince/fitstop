import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/services/assistant/draft-agent-service", () => ({
  runAssistantTurn: vi.fn(),
}));

vi.mock("@/services/client-service", () => ({
  getClientById: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedCoachId: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  assistantRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));

import { POST } from "./route";
import { runAssistantTurn } from "@/services/assistant/draft-agent-service";
import { getClientById } from "@/services/client-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { assistantRateLimit } from "@/lib/rate-limit";
import { makeRestWeek } from "@/components/clients/training/program-builder/program-builder-types";

const mockRun = vi.mocked(runAssistantTurn);
const mockClient = vi.mocked(getClientById);
const mockAuth = vi.mocked(getAuthenticatedCoachId);
const mockRate = vi.mocked(assistantRateLimit);

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/training/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const draft = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Program",
  description: null,
  status: "saved",
  splitType: null,
  programDurationWeeks: null,
  defaultSurplusPercentage: null,
  weeks: [makeRestWeek(0)],
};

const validBody = {
  target: "library",
  command: "add a leg day",
  transcript: [],
  draft,
};

const turnResult = {
  assistantText: "Done",
  ops: [],
  skipped: [],
  stopReason: "done" as const,
};

describe("POST /api/training/assistant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue("coach-1");
    mockRate.mockResolvedValue(null);
    mockRun.mockResolvedValue(turnResult);
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(401);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("returns the rate-limit response without running a turn", async () => {
    mockRate.mockResolvedValue(
      NextResponse.json({ error: "Too many requests" }, { status: 429 }),
    );
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(429);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("returns 400 on an invalid body", async () => {
    const res = await POST(makeRequest({ ...validBody, command: "" }));
    expect(res.status).toBe(400);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("returns 400 when a client-draft turn omits clientId", async () => {
    const res = await POST(makeRequest({ ...validBody, target: "client-draft" }));
    expect(res.status).toBe(400);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("404s an unknown client and 403s another coach's client", async () => {
    const clientBody = {
      ...validBody,
      target: "client-draft",
      clientId: "55555555-5555-4555-8555-555555555555",
    };
    mockClient.mockResolvedValue(null);
    expect((await POST(makeRequest(clientBody))).status).toBe(404);

    mockClient.mockResolvedValue({ id: clientBody.clientId, coachId: "other-coach" } as never);
    expect((await POST(makeRequest(clientBody))).status).toBe(403);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("runs the turn and returns its data on success", async () => {
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ success: true, data: turnResult });
    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({
        coachId: "coach-1",
        target: "library",
        command: "add a leg day",
      }),
    );
  });

  it("maps a missing API key to a clear 500 without leaking internals", async () => {
    mockRun.mockRejectedValue(new Error("ANTHROPIC_API_KEY is not configured"));
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/isn't configured/);
  });
});
