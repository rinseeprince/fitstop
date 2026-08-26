import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

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

const { LayoutDriftError, LayoutNotFoundError, LayoutPolicyError, DateOccupiedError } =
  vi.hoisted(() => ({
    LayoutDriftError: class LayoutDriftError extends Error {},
    LayoutNotFoundError: class LayoutNotFoundError extends Error {},
    LayoutPolicyError: class LayoutPolicyError extends Error {},
    DateOccupiedError: class DateOccupiedError extends Error {},
  }));

vi.mock("@/services/training-event-layout-service", () => ({
  applyClientLayout: vi.fn(),
  LayoutDriftError,
  LayoutNotFoundError,
  LayoutPolicyError,
}));

vi.mock("@/services/training-event-occupancy", () => ({
  DateOccupiedError,
}));

import { POST } from "./route";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { applyClientLayout } from "@/services/training-event-layout-service";

const CLIENT_ID = "22222222-2222-2222-2222-222222222222";
const EVENT_A = "33333333-3333-3333-3333-333333333333";
const EVENT_B = "44444444-4444-4444-4444-444444444444";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/client/training/events/layout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const swap = {
  moves: [
    { eventId: EVENT_A, fromDate: "2026-08-26", toDate: "2026-08-27" },
    { eventId: EVENT_B, fromDate: "2026-08-27", toDate: "2026-08-26" },
  ],
};

describe("POST /api/client/training/events/layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(CLIENT_ID);
    vi.mocked(applyClientLayout).mockResolvedValue({ moved: swap.moves });
  });

  it("401s an unauthenticated caller before touching the service", async () => {
    vi.mocked(getAuthenticatedClientId).mockResolvedValue(null);

    const res = await POST(makeRequest(swap));

    expect(res.status).toBe(401);
    expect(applyClientLayout).not.toHaveBeenCalled();
  });

  it("400s malformed JSON and an invalid body", async () => {
    const malformed = await POST(makeRequest("{not json"));
    expect(malformed.status).toBe(400);

    const badShape = await POST(makeRequest({ moves: [] }));
    expect(badShape.status).toBe(400);

    const badDate = await POST(
      makeRequest({ moves: [{ eventId: EVENT_A, fromDate: "26/08/2026", toDate: "2026-08-27" }] }),
    );
    expect(badDate.status).toBe(400);

    expect(applyClientLayout).not.toHaveBeenCalled();
  });

  it("applies the layout for the AUTHED client only and returns what moved", async () => {
    const res = await POST(makeRequest(swap));

    expect(res.status).toBe(200);
    expect(applyClientLayout).toHaveBeenCalledWith(CLIENT_ID, swap.moves);
    const json = await res.json();
    expect(json).toEqual({ success: true, data: { moved: swap.moves } });
  });

  it("maps the service's errors: 409 taken day, 409 drift, 400 policy, 404 unknown", async () => {
    vi.mocked(applyClientLayout).mockRejectedValueOnce(
      new DateOccupiedError("Sat, Aug 29 already has a session"),
    );
    let res = await POST(makeRequest(swap));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      success: false,
      error: "Sat, Aug 29 already has a session",
    });

    vi.mocked(applyClientLayout).mockRejectedValueOnce(new LayoutDriftError("Your week changed"));
    res = await POST(makeRequest(swap));
    expect(res.status).toBe(409);

    vi.mocked(applyClientLayout).mockRejectedValueOnce(
      new LayoutPolicyError("A session can only move within its own week"),
    );
    res = await POST(makeRequest(swap));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      error: "A session can only move within its own week",
    });

    vi.mocked(applyClientLayout).mockRejectedValueOnce(new LayoutNotFoundError("Session not found"));
    res = await POST(makeRequest(swap));
    expect(res.status).toBe(404);
    // No existence oracle: the body never names what was not found.
    expect(await res.json()).toEqual({ success: false, error: "Not found" });
  });

  it("500s an unexpected failure without leaking it", async () => {
    vi.mocked(applyClientLayout).mockRejectedValueOnce(new Error("db exploded"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(makeRequest(swap));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "Failed to move sessions" });
    spy.mockRestore();
  });
});
