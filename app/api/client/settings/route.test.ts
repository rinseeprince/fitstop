import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { PATCH } from "./route";

vi.mock("@/lib/rate-limit", () => ({
  clientApiRateLimit: vi.fn().mockResolvedValue(null),
  clientPerClientRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/auth-helpers", () => ({
  getAuthenticatedClientId: vi.fn(),
}));

vi.mock("@/services/client-service", () => ({
  updateClientSettings: vi.fn(),
}));

import { clientApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { updateClientSettings } from "@/services/client-service";

function createMockRequest(body?: unknown) {
  return new NextRequest("http://localhost:3000/api/client/settings", {
    method: "PATCH",
    ...(body !== undefined
      ? {
          body: typeof body === "string" ? body : JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
        }
      : {}),
  });
}

describe("PATCH /api/client/settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clientApiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCSRFProtection).mockResolvedValue(null);
    vi.mocked(getAuthenticatedClientId).mockResolvedValue("client-1");
    vi.mocked(updateClientSettings).mockResolvedValue({
      id: "client-1",
      coachId: "coach-1",
      name: "Test",
      email: "test@example.com",
      active: true,
      includeActivityBurn: true,
      surplusAsCarbs: false,
      timezone: "UTC",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    } as never);
  });

  it("returns 200 and calls service for unitPreference: 'metric'", async () => {
    const response = await PATCH(createMockRequest({ unitPreference: "metric" }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(updateClientSettings).toHaveBeenCalledWith("client-1", {
      unitPreference: "metric",
    });
  });

  it("returns 200 for valid IANA timezone", async () => {
    const response = await PATCH(
      createMockRequest({ timezone: "America/Los_Angeles" }),
    );

    expect(response.status).toBe(200);
    expect(updateClientSettings).toHaveBeenCalledWith("client-1", {
      timezone: "America/Los_Angeles",
    });
  });

  it("returns 400 on invalid unitPreference enum", async () => {
    const response = await PATCH(createMockRequest({ unitPreference: "foo" }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(updateClientSettings).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid IANA timezone", async () => {
    const response = await PATCH(
      createMockRequest({ timezone: "Mars/Olympus" }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Invalid timezone");
    expect(updateClientSettings).not.toHaveBeenCalled();
  });

  it("returns 400 on empty body (refine rejects no-op)", async () => {
    const response = await PATCH(createMockRequest({}));

    expect(response.status).toBe(400);
    expect(updateClientSettings).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid JSON", async () => {
    const response = await PATCH(createMockRequest("not-json{"));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Invalid JSON");
    expect(updateClientSettings).not.toHaveBeenCalled();
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(null);
    const response = await PATCH(createMockRequest({ unitPreference: "metric" }));

    expect(response.status).toBe(401);
    expect(updateClientSettings).not.toHaveBeenCalled();
  });

  it("returns CSRF error response when CSRF rejects", async () => {
    const csrfResponse = NextResponse.json(
      { success: false, error: "CSRF" },
      { status: 403 },
    );
    vi.mocked(requireCSRFProtection).mockResolvedValue(csrfResponse);

    const response = await PATCH(createMockRequest({ unitPreference: "metric" }));

    expect(response.status).toBe(403);
    expect(getAuthenticatedClientId).not.toHaveBeenCalled();
    expect(updateClientSettings).not.toHaveBeenCalled();
  });

  it("returns rate-limit response when rate limit fires", async () => {
    const rateLimitResponse = NextResponse.json(
      { success: false, error: "Rate limited" },
      { status: 429 },
    );
    vi.mocked(clientApiRateLimit).mockResolvedValue(rateLimitResponse);

    const response = await PATCH(createMockRequest({ unitPreference: "metric" }));

    expect(response.status).toBe(429);
    expect(requireCSRFProtection).not.toHaveBeenCalled();
    expect(getAuthenticatedClientId).not.toHaveBeenCalled();
    expect(updateClientSettings).not.toHaveBeenCalled();
  });

  it("returns 500 with generic error when service throws", async () => {
    vi.mocked(updateClientSettings).mockRejectedValue(new Error("DB blew up"));

    const response = await PATCH(createMockRequest({ unitPreference: "metric" }));
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error).toBe("Failed to update settings");
  });
});
