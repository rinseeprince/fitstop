import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  clientApiRateLimit: vi.fn().mockResolvedValue(null),
  clientPerClientRateLimit: vi.fn().mockResolvedValue(null),
  apiRateLimit: vi.fn().mockResolvedValue(null),
  authRateLimit: vi.fn().mockResolvedValue(null),
  checkInRateLimit: vi.fn().mockResolvedValue(null),
  aiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedClientId: vi.fn(),
}));

const { NoActivePlanError, DayLockedError } = vi.hoisted(() => {
  class NoActivePlanError extends Error {
    resource: string;
    constructor(resource: string) {
      super(`No active plan for ${resource}`);
      this.name = "NoActivePlanError";
      this.resource = resource;
    }
  }
  class DayLockedError extends Error {
    constructor(date: string, _resourceType?: string) {
      super(`Day ${date} is locked`);
      this.name = "DayLockedError";
    }
  }
  return { NoActivePlanError, DayLockedError };
});

vi.mock("@/services/daily-context-service", () => ({
  resolvePlanContextForDate: vi.fn(),
  assertHasActivePlan: vi.fn(),
  NoActivePlanError,
}));

vi.mock("@/lib/daily-log-permissions", () => ({ DayLockedError }));

vi.mock("@/services/training-log-service", () => ({
  logTrainingSessionForDate: vi.fn(),
  TrainingLogOwnershipError: class TrainingLogOwnershipError extends Error {},
}));

import { POST } from "./route";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import {
  resolvePlanContextForDate,
  assertHasActivePlan,
} from "@/services/daily-context-service";
import { logTrainingSessionForDate } from "@/services/training-log-service";

const CLIENT_ID = "22222222-2222-2222-2222-222222222222";
const SESSION_ID = "33333333-3333-3333-3333-333333333333";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(
    "http://localhost:3000/api/client/training/session-logs",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

const validBody = {
  date: "2026-05-08",
  performedSessionId: SESSION_ID,
  completionQuality: "full",
};

describe("POST /api/client/training/session-logs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCSRFProtection).mockResolvedValue(null);
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(CLIENT_ID);
    vi.mocked(resolvePlanContextForDate).mockResolvedValue({
      nutritionPlanId: null,
      trainingPlanId: "tp-1",
    });
    vi.mocked(assertHasActivePlan).mockReturnValue(undefined);
  });

  it("returns 201 with sessionLogId on success", async () => {
    vi.mocked(logTrainingSessionForDate).mockResolvedValue({ sessionLogId: "log-1" });

    const res = await POST(makeRequest(validBody));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data).toEqual({ success: true, data: { sessionLogId: "log-1" } });
    expect(logTrainingSessionForDate).toHaveBeenCalledWith({
      clientId: CLIENT_ID,
      date: "2026-05-08",
      payload: validBody,
    });
  });

  it("returns 400 on a malformed body (missing performedSessionId)", async () => {
    const res = await POST(
      makeRequest({ date: "2026-05-08", completionQuality: "full" }),
    );
    expect(res.status).toBe(400);
    expect(logTrainingSessionForDate).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(null);
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(401);
    expect(logTrainingSessionForDate).not.toHaveBeenCalled();
  });

  it("returns 422 when there is no active training plan", async () => {
    vi.mocked(assertHasActivePlan).mockImplementation(() => {
      throw new NoActivePlanError("training");
    });
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(422);
    expect(logTrainingSessionForDate).not.toHaveBeenCalled();
  });

  it("returns 403 when the day is locked (service throws DayLockedError)", async () => {
    vi.mocked(logTrainingSessionForDate).mockRejectedValue(
      new DayLockedError("2026-05-08", "training"),
    );
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(403);
  });

  it("returns the CSRF rejection verbatim", async () => {
    vi.mocked(requireCSRFProtection).mockResolvedValue(
      NextResponse.json({ success: false, error: "csrf" }, { status: 403 }),
    );
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(403);
    expect(logTrainingSessionForDate).not.toHaveBeenCalled();
  });
});
