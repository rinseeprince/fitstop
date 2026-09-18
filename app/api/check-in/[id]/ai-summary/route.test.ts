import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/rate-limit", () => ({
  aiRateLimit: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/csrf-protection", () => ({
  requireCSRFProtection: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/require-coach-auth", () => ({
  requireCoachOwnsCheckIn: vi.fn(),
}));
vi.mock("@/services/check-in-service", () => ({
  updateCheckInAISummary: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/services/ai-service", () => ({
  generateCheckInReview: vi.fn(),
}));
vi.mock("@/services/check-in-review-input-service", () => ({
  getCheckInReviewInput: vi.fn(),
}));

import { POST } from "./route";
import { requireCoachOwnsCheckIn } from "@/lib/require-coach-auth";
import { aiRateLimit } from "@/lib/rate-limit";
import { updateCheckInAISummary } from "@/services/check-in-service";
import { generateCheckInReview } from "@/services/ai-service";
import { getCheckInReviewInput } from "@/services/check-in-review-input-service";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (body: unknown = {}) =>
  new NextRequest("https://t.dev/api/check-in/ci-1/ai-summary", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

const input = { checkIn: { id: "ci-1" }, clientName: "Jane" };
const review = { summary: "s", watchItems: [], themes: [], coachActions: [], clientMessage: "m" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireCoachOwnsCheckIn).mockResolvedValue({
    authorized: true,
    coachId: "coach-1",
    checkIn: { id: "ci-1", clientId: "client-1" },
  } as never);
  vi.mocked(getCheckInReviewInput).mockResolvedValue(input as never);
  vi.mocked(generateCheckInReview).mockResolvedValue(review);
});

describe("POST /api/check-in/[id]/ai-summary — Regenerate", () => {
  it("builds the review's input for the check-in and hands it to the generator unchanged, then stores the review", async () => {
    const res = await POST(req(), params("ci-1"));

    expect(res.status).toBe(200);
    expect(getCheckInReviewInput).toHaveBeenCalledWith("ci-1");
    expect(generateCheckInReview).toHaveBeenCalledWith(input);
    expect(updateCheckInAISummary).toHaveBeenCalledWith("ci-1", review);
    await expect(res.json()).resolves.toEqual({ success: true, summary: review });
  });

  it("rate-limits by the authed coach before reading anything", async () => {
    vi.mocked(aiRateLimit).mockResolvedValueOnce(new Response(null, { status: 429 }) as never);
    const res = await POST(req(), params("ci-1"));
    expect(res.status).toBe(429);
    expect(getCheckInReviewInput).not.toHaveBeenCalled();
  });

  it("refuses a foreign coach before reading anything", async () => {
    vi.mocked(requireCoachOwnsCheckIn).mockResolvedValue({
      authorized: false,
      response: new Response(null, { status: 403 }),
    } as never);
    const res = await POST(req(), params("ci-1"));
    expect(res.status).toBe(403);
    expect(getCheckInReviewInput).not.toHaveBeenCalled();
  });

  it("404s when the check-in has gone, and calls no model", async () => {
    vi.mocked(getCheckInReviewInput).mockResolvedValue(null);
    const res = await POST(req(), params("ci-1"));
    expect(res.status).toBe(404);
    expect(generateCheckInReview).not.toHaveBeenCalled();
  });

  it("400s a body that is not an object", async () => {
    const res = await POST(req(null), params("ci-1"));
    expect(res.status).toBe(400);
    expect(getCheckInReviewInput).not.toHaveBeenCalled();
  });

  it("500s when the generator fails, and stores nothing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(generateCheckInReview).mockRejectedValue(new Error("model down"));
    const res = await POST(req(), params("ci-1"));
    expect(res.status).toBe(500);
    expect(updateCheckInAISummary).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
