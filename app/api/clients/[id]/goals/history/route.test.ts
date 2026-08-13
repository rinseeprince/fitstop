import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/require-coach-auth", () => ({
  requireCoachOwnsClient: vi.fn(),
}));

vi.mock("@/services/client-goals-service", () => ({
  getGoalsHistory: vi.fn(),
}));

import { GET } from "./route";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getGoalsHistory } from "@/services/client-goals-service";

const mockParams = { params: Promise.resolve({ id: "client-1" }) };

const request = () =>
  new NextRequest("http://localhost:3000/api/clients/client-1/goals/history");

const superseded = {
  id: "goal-0",
  clientId: "client-1",
  goalWeight: 88,
  goalDeadline: "2026-06-01",
  setBy: "coach-1",
  effectiveFrom: "2026-01-01T00:00:00Z",
  supersededAt: "2026-07-14T00:00:00Z",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-07-14T00:00:00Z",
};

describe("GET /api/clients/[id]/goals/history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(coachApiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: true,
      coachId: "coach-1",
    } as never);
    vi.mocked(getGoalsHistory).mockResolvedValue([superseded] as never);
  });

  it("returns the superseded versions as a flat array", async () => {
    const response = await GET(request(), mockParams);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].goalWeight).toBe(88);
    // A sibling route, NOT the old `{ current, history }` switch — the flat
    // shape is the whole reason it exists.
    expect(body.data).not.toHaveProperty("current");
  });

  it("is no-store: a goal edit must not be served a cached history", async () => {
    const response = await GET(request(), mockParams);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("refuses a client the coach does not own, before reading anything", async () => {
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: false,
      response: new Response(null, { status: 404 }),
    } as never);

    const response = await GET(request(), mockParams);

    expect(response.status).toBe(404);
    expect(getGoalsHistory).not.toHaveBeenCalled();
  });

  it("rate limits before authorizing", async () => {
    vi.mocked(coachApiRateLimit).mockResolvedValue(
      new Response(null, { status: 429 }) as never
    );

    const response = await GET(request(), mockParams);

    expect(response.status).toBe(429);
    expect(requireCoachOwnsClient).not.toHaveBeenCalled();
  });

  it("returns a generic 500 without leaking the raw error", async () => {
    vi.mocked(getGoalsHistory).mockRejectedValue(new Error("relation does not exist"));

    const response = await GET(request(), mockParams);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("relation does not exist");
  });
});
