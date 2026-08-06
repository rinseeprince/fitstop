import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: vi.fn(),
}));

vi.mock("@/lib/viewer-preferences", () => ({
  resolveViewerUnitPreference: vi.fn(),
}));

vi.mock("@/lib/error-handler", () => ({
  captureApiError: vi.fn(),
}));

import { GET } from "./route";
import { apiRateLimit } from "@/lib/rate-limit";
import { captureApiError } from "@/lib/error-handler";
import { resolveViewerUnitPreference } from "@/lib/viewer-preferences";

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/me/unit-preference");
}

describe("GET /api/me/unit-preference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiRateLimit).mockResolvedValue(null);
    vi.mocked(resolveViewerUnitPreference).mockResolvedValue("metric");
  });

  it("returns the viewer's preference in the standard envelope", async () => {
    vi.mocked(resolveViewerUnitPreference).mockResolvedValue("imperial");

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: { preference: "imperial" } });
  });

  it("sets Cache-Control: no-store", async () => {
    const response = await GET(makeRequest());

    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 401 when no principal resolves", async () => {
    vi.mocked(resolveViewerUnitPreference).mockResolvedValue(null);

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ success: false, error: "Unauthorized" });
  });

  it("returns 500 on a database error instead of a guessed default", async () => {
    vi.mocked(resolveViewerUnitPreference).mockRejectedValue(
      new Error("connection reset")
    );

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    // No `preference` in the payload — a caller must not be able to mistake a
    // failure for a resolved metric answer.
    expect(body).toEqual({
      success: false,
      error: "Failed to load unit preference",
    });
    expect(captureApiError).toHaveBeenCalledTimes(1);
  });

  it("short-circuits on the rate limit before resolving anything", async () => {
    const limited = NextResponse.json({ error: "Too many requests" }, { status: 429 });
    vi.mocked(apiRateLimit).mockResolvedValue(limited);

    const response = await GET(makeRequest());

    expect(response.status).toBe(429);
    expect(resolveViewerUnitPreference).not.toHaveBeenCalled();
  });

  it("passes the request to the resolver so auth failures log route + IP", async () => {
    const request = makeRequest();

    await GET(request);

    expect(resolveViewerUnitPreference).toHaveBeenCalledWith(request);
  });
});
