import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { PATCH } from "./route";

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedCoachId: vi.fn(),
}));

vi.mock("@/services/coach-service", () => ({
  updateCoachSettings: vi.fn(),
}));

import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { updateCoachSettings } from "@/services/coach-service";

function createMockRequest(body?: unknown) {
  return new NextRequest("http://localhost:3000/api/coach/settings", {
    method: "PATCH",
    ...(body !== undefined
      ? {
          body: typeof body === "string" ? body : JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
        }
      : {}),
  });
}

describe("PATCH /api/coach/settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(coachApiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(null);
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue("coach-1");
    vi.mocked(updateCoachSettings).mockResolvedValue({
      id: "coach-1",
      name: "Test Coach",
      email: "coach@example.com",
      timezone: "Europe/London",
      unitPreference: "metric",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    });
  });

  it("returns 200 and calls the service for a valid IANA timezone", async () => {
    const response = await PATCH(
      createMockRequest({ timezone: "Europe/London" }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(updateCoachSettings).toHaveBeenCalledWith("coach-1", {
      timezone: "Europe/London",
    });
  });

  it("returns 400 on an invalid IANA timezone", async () => {
    const response = await PATCH(createMockRequest({ timezone: "Mars/Olympus" }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Invalid timezone");
    expect(updateCoachSettings).not.toHaveBeenCalled();
  });

  it("returns 400 on an empty body", async () => {
    const response = await PATCH(createMockRequest({}));

    expect(response.status).toBe(400);
    expect(updateCoachSettings).not.toHaveBeenCalled();
  });

  // Both fields are optional so the two writers can send one each — the
  // timezone auto-sync and the Settings units card. A schema requiring both
  // would make each clobber the other's field.
  it("accepts unitPreference alone, with no timezone", async () => {
    const response = await PATCH(
      createMockRequest({ unitPreference: "imperial" }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(updateCoachSettings).toHaveBeenCalledWith("coach-1", {
      unitPreference: "imperial",
    });
  });

  it("accepts both fields together", async () => {
    const response = await PATCH(
      createMockRequest({ timezone: "Europe/London", unitPreference: "metric" }),
    );

    expect(response.status).toBe(200);
    expect(updateCoachSettings).toHaveBeenCalledWith("coach-1", {
      timezone: "Europe/London",
      unitPreference: "metric",
    });
  });

  it("returns 400 on an unknown unitPreference value", async () => {
    const response = await PATCH(createMockRequest({ unitPreference: "stone" }));

    expect(response.status).toBe(400);
    expect(updateCoachSettings).not.toHaveBeenCalled();
  });

  // Regression: the timezone validity check ran unconditionally, so a
  // unitPreference-only body would have been rejected by an IANA lookup of
  // `undefined`.
  it("does not run the IANA check when timezone is absent", async () => {
    const response = await PATCH(createMockRequest({ unitPreference: "metric" }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.error).toBeUndefined();
  });

  it("returns 400 on invalid JSON", async () => {
    const response = await PATCH(createMockRequest("not-json{"));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Invalid JSON");
    expect(updateCoachSettings).not.toHaveBeenCalled();
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(getAuthenticatedCoachId).mockResolvedValue(null);
    const response = await PATCH(
      createMockRequest({ timezone: "Europe/London" }),
    );

    expect(response.status).toBe(401);
    expect(updateCoachSettings).not.toHaveBeenCalled();
  });

  it("returns the CSRF error response when CSRF rejects", async () => {
    const csrfResponse = NextResponse.json(
      { success: false, error: "CSRF" },
      { status: 403 },
    );
    vi.mocked(requireCSRFProtection).mockResolvedValue(csrfResponse);

    const response = await PATCH(
      createMockRequest({ timezone: "Europe/London" }),
    );

    expect(response.status).toBe(403);
    expect(getAuthenticatedCoachId).not.toHaveBeenCalled();
    expect(updateCoachSettings).not.toHaveBeenCalled();
  });

  it("returns the rate-limit response when the rate limit fires", async () => {
    const rateLimitResponse = NextResponse.json(
      { success: false, error: "Rate limited" },
      { status: 429 },
    );
    vi.mocked(coachApiRateLimit).mockResolvedValue(rateLimitResponse);

    const response = await PATCH(
      createMockRequest({ timezone: "Europe/London" }),
    );

    expect(response.status).toBe(429);
    expect(requireCSRFProtection).not.toHaveBeenCalled();
    expect(updateCoachSettings).not.toHaveBeenCalled();
  });

  it("returns 500 with a generic error when the service throws", async () => {
    vi.mocked(updateCoachSettings).mockRejectedValue(new Error("DB blew up"));

    const response = await PATCH(
      createMockRequest({ timezone: "Europe/London" }),
    );
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error).toBe("Failed to update settings");
  });
});
