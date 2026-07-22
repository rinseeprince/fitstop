import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/services/assistant/draft-agent-service", () => ({
  runAssistantTurn: vi.fn(),
}));

vi.mock("@/services/client-service", () => ({
  getClientById: vi.fn(),
}));

vi.mock("@/services/training-service", () => ({
  getTrainingPlanById: vi.fn(),
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
import { getTrainingPlanById } from "@/services/training-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { assistantRateLimit } from "@/lib/rate-limit";
import { makeRestWeek } from "@/components/clients/training/program-builder/program-builder-types";

const mockRun = vi.mocked(runAssistantTurn);
const mockClient = vi.mocked(getClientById);
const mockPlan = vi.mocked(getTrainingPlanById);
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

describe("POST /api/training/assistant placed-plan target", () => {
  const clientId = "55555555-5555-4555-8555-555555555555";
  const planId = "66666666-6666-4666-8666-666666666666";
  const placedBody = {
    ...validBody,
    target: "placed-plan",
    clientId,
    planId,
    lockedSlotUids: ["slot-a", "slot-b"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue("coach-1");
    mockRate.mockResolvedValue(null);
    mockRun.mockResolvedValue(turnResult);
    mockClient.mockResolvedValue({ id: clientId, coachId: "coach-1" } as never);
    mockPlan.mockResolvedValue({ id: planId, clientId } as never);
  });

  it("400s when planId or lockedSlotUids are missing (schema refine)", async () => {
    expect(
      (await POST(makeRequest({ ...placedBody, planId: undefined }))).status,
    ).toBe(400);
    expect(
      (await POST(makeRequest({ ...placedBody, lockedSlotUids: undefined }))).status,
    ).toBe(400);
    expect(
      (await POST(makeRequest({ ...placedBody, clientId: undefined }))).status,
    ).toBe(400);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("400s the placed-only fields on other targets (schema refine)", async () => {
    expect(
      (await POST(makeRequest({ ...validBody, planId }))).status,
    ).toBe(400);
    expect(
      (await POST(makeRequest({ ...validBody, lockedSlotUids: ["slot-a"] }))).status,
    ).toBe(400);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("404s a plan that doesn't exist or belongs to another client", async () => {
    mockPlan.mockResolvedValue(null);
    expect((await POST(makeRequest(placedBody))).status).toBe(404);

    mockPlan.mockResolvedValue({ id: planId, clientId: "other-client" } as never);
    expect((await POST(makeRequest(placedBody))).status).toBe(404);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("still verifies client ownership before the plan check", async () => {
    mockClient.mockResolvedValue({ id: clientId, coachId: "other-coach" } as never);
    expect((await POST(makeRequest(placedBody))).status).toBe(403);
    expect(mockPlan).not.toHaveBeenCalled();
  });

  it("forwards the lock set into the turn", async () => {
    const res = await POST(makeRequest(placedBody));
    expect(res.status).toBe(200);
    expect(mockPlan).toHaveBeenCalledWith(planId);
    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "placed-plan",
        lockedSlotUids: ["slot-a", "slot-b"],
      }),
    );
  });
});
