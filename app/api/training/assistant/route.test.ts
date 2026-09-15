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
  // The editor's editable days: from its first editable day to the plan's limit.
  const editableDays = { from: 3, through: 20 };
  const placedBody = {
    ...validBody,
    target: "placed-plan",
    clientId,
    planId,
    editableDays,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue("coach-1");
    mockRate.mockResolvedValue(null);
    mockRun.mockResolvedValue(turnResult);
    mockClient.mockResolvedValue({ id: clientId, coachId: "coach-1" } as never);
    mockPlan.mockResolvedValue({ id: planId, clientId } as never);
  });

  it("400s when clientId, planId or editableDays is missing (schema refine)", async () => {
    for (const missing of ["clientId", "planId", "editableDays"] as const) {
      const res = await POST(makeRequest({ ...placedBody, [missing]: undefined }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/required for the placed-plan editor/);
    }
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("400s malformed editable days", async () => {
    for (const bad of [{ from: -1, through: null }, { from: 3 }, { from: 2.5, through: 20 }]) {
      expect((await POST(makeRequest({ ...placedBody, editableDays: bad }))).status).toBe(400);
    }
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("400s planId or editableDays on another target (schema refine)", async () => {
    for (const body of [
      { ...validBody, planId },
      { ...validBody, editableDays },
      { ...validBody, target: "client-draft", clientId, editableDays },
    ]) {
      const res = await POST(makeRequest(body));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/only valid for the placed-plan editor/);
    }
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

  it("forwards the editable days into the turn", async () => {
    const res = await POST(makeRequest(placedBody));
    expect(res.status).toBe(200);
    expect(mockPlan).toHaveBeenCalledWith(planId);
    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "placed-plan",
        editableDays: { from: 3, through: 20 },
      }),
    );

    // A plan nothing bounds has no last day.
    await POST(makeRequest({ ...placedBody, editableDays: { from: 0, through: null } }));
    expect(mockRun).toHaveBeenLastCalledWith(
      expect.objectContaining({ editableDays: { from: 0, through: null } }),
    );
  });
});
