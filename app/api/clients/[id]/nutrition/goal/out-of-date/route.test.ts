import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  coachApiRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/require-coach-auth", () => ({
  requireCoachOwnsClient: vi.fn(),
}));

vi.mock("@/lib/error-handler", () => ({
  captureApiError: vi.fn(),
}));

vi.mock("@/services/nutrition-goal-service", () => ({
  getNutritionOutOfDate: vi.fn(),
}));

import { GET } from "./route";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getNutritionOutOfDate } from "@/services/nutrition-goal-service";

const params = { params: Promise.resolve({ id: "client-5" }) };
const request = () =>
  new NextRequest("http://localhost:3000/api/clients/client-5/nutrition/goal/out-of-date");

describe("GET /api/clients/[id]/nutrition/goal/out-of-date — the one rule's answer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(coachApiRateLimit).mockResolvedValue(null);
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: true,
      coachId: "coach-5",
    } as never);
    vi.mocked(getNutritionOutOfDate).mockResolvedValue({
      clientToday: "2026-09-23",
      outOfDate: null,
    });
  });

  it("answers for the client the coach owns, never cached", async () => {
    const response = await GET(request(), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: { clientToday: "2026-09-23", outOfDate: null } });
    expect(requireCoachOwnsClient).toHaveBeenCalledWith("client-5", expect.any(NextRequest));
    expect(getNutritionOutOfDate).toHaveBeenCalledWith("client-5");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rate-limits before anything else", async () => {
    vi.mocked(coachApiRateLimit).mockResolvedValue(new Response(null, { status: 429 }) as never);

    const response = await GET(request(), params);

    expect(response.status).toBe(429);
    expect(requireCoachOwnsClient).not.toHaveBeenCalled();
  });

  it("refuses a client the coach does not own, before reading anything", async () => {
    vi.mocked(requireCoachOwnsClient).mockResolvedValue({
      authorized: false,
      response: new Response(null, { status: 404 }),
    } as never);

    const response = await GET(request(), params);

    expect(response.status).toBe(404);
    expect(getNutritionOutOfDate).not.toHaveBeenCalled();
  });

  it("is 500 when the read fails", async () => {
    vi.mocked(getNutritionOutOfDate).mockRejectedValue(new Error("db down"));
    expect((await GET(request(), params)).status).toBe(500);
  });
});
