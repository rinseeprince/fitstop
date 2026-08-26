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

vi.mock("@/services/training-log-service", () => ({
  logTrainingEvent: vi.fn(),
  TrainingLogOwnershipError: class TrainingLogOwnershipError extends Error {},
}));

import { POST } from "./route";
import { clientApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { logTrainingEvent } from "@/services/training-log-service";
import { DayLockedError } from "@/lib/daily-log-permissions";

const EVENT_ID = "11111111-1111-1111-1111-111111111111";
const CLIENT_ID = "22222222-2222-2222-2222-222222222222";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/client/training/events/${EVENT_ID}/log`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

const validBody = {
  completionQuality: "full",
  notes: "felt strong",
};

describe("POST /api/client/training/events/[eventId]/log", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clientApiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(null);
  });

  it("returns 201 with sessionLogId on success", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(CLIENT_ID);
    vi.mocked(logTrainingEvent).mockResolvedValue({ sessionLogId: "log-1" });

    const response = await POST(makeRequest(validBody), {
      params: Promise.resolve({ eventId: EVENT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data).toEqual({ success: true, data: { sessionLogId: "log-1" } });
    expect(logTrainingEvent).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      clientId: CLIENT_ID,
      payload: { completionQuality: "full", notes: "felt strong" },
    });
  });

  it("returns 400 when body is malformed (missing completionQuality)", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(CLIENT_ID);

    const response = await POST(makeRequest({ notes: "no quality" }), {
      params: Promise.resolve({ eventId: EVENT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toBe("Invalid input");
    expect(logTrainingEvent).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(null);

    const response = await POST(makeRequest(validBody), {
      params: Promise.resolve({ eventId: EVENT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(logTrainingEvent).not.toHaveBeenCalled();
  });

  it("returns CSRF rejection response verbatim when CSRF fails", async () => {
    const csrfResponse = NextResponse.json(
      { success: false, error: "CSRF validation failed" },
      { status: 403 },
    );
    vi.mocked(requireCSRFProtection).mockResolvedValue(csrfResponse);
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(CLIENT_ID);

    const response = await POST(makeRequest(validBody), {
      params: Promise.resolve({ eventId: EVENT_ID }),
    });

    expect(response.status).toBe(403);
    expect(getAuthenticatedClientId).not.toHaveBeenCalled();
    expect(logTrainingEvent).not.toHaveBeenCalled();
  });

  it("returns rate-limit response verbatim when rate limited", async () => {
    const rlResponse = NextResponse.json(
      { error: "Rate limited" },
      { status: 429 },
    );
    vi.mocked(clientApiRateLimit).mockResolvedValue(rlResponse);

    const response = await POST(makeRequest(validBody), {
      params: Promise.resolve({ eventId: EVENT_ID }),
    });

    expect(response.status).toBe(429);
    expect(requireCSRFProtection).not.toHaveBeenCalled();
    expect(logTrainingEvent).not.toHaveBeenCalled();
  });

  it("returns 404 when service throws 'Training event not found' (covers wrong-client)", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(CLIENT_ID);
    vi.mocked(logTrainingEvent).mockRejectedValue(
      new Error(`Training event not found: ${EVENT_ID}`),
    );

    const response = await POST(makeRequest(validBody), {
      params: Promise.resolve({ eventId: EVENT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toEqual({ success: false, error: "Event not found" });
  });

  it("returns 403 when the day is locked (service throws DayLockedError)", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(CLIENT_ID);
    vi.mocked(logTrainingEvent).mockRejectedValue(
      new DayLockedError("2026-05-01", "training"),
    );

    const response = await POST(makeRequest(validBody), {
      params: Promise.resolve({ eventId: EVENT_ID }),
    });

    expect(response.status).toBe(403);
  });

  it("returns 500 when service throws an unexpected error", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(CLIENT_ID);
    vi.mocked(logTrainingEvent).mockRejectedValue(new Error("DB exploded"));

    const response = await POST(makeRequest(validBody), {
      params: Promise.resolve({ eventId: EVENT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
  });
});
