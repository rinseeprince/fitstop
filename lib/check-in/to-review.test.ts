import { describe, it, expect } from "vitest";
import { toCheckInReview } from "./to-review";
import type { CheckIn } from "@/types/check-in";

const base = (overrides: Partial<CheckIn>): CheckIn => ({
  id: "c1",
  clientId: "cl1",
  status: "ai_processed",
  createdAt: "2026-06-01T00:00:00Z",
  updatedAt: "2026-06-01T00:00:00Z",
  ...overrides,
});

describe("toCheckInReview", () => {
  it("passes v3 data straight through", () => {
    const checkIn = base({
      aiSummary: "Summary",
      aiResponseDraft: "Message",
      aiInsights: {
        _version: 3,
        watchItems: [{ type: "win", text: "Win" }],
        themes: ["t"],
        coachActions: [{ priority: "high", text: "Do" }],
      },
    });

    expect(toCheckInReview(checkIn)).toEqual({
      summary: "Summary",
      clientMessage: "Message",
      watchItems: [{ type: "win", text: "Win" }],
      themes: ["t"],
      coachActions: [{ priority: "high", text: "Do" }],
    });
  });

  it("maps legacy v2 insights to watch items and themes, stripping markdown", () => {
    const checkIn = base({
      aiSummary: "**Bold** summary",
      aiResponseDraft: "Hi",
      aiInsights: {
        _version: 2,
        insights: [
          { type: "strength", text: "Strong" },
          { type: "concern", text: "Risky" },
          { type: "trend", text: "Up" },
        ],
        notesIntelligence: { themes: ["stress"], concerns: ["pain"], positives: [], rawNotes: [] },
        coachActions: [{ action: "Act now", urgency: "now", context: "" }],
      },
    });

    const review = toCheckInReview(checkIn);
    expect(review.summary).toBe("Bold summary");
    expect(review.watchItems).toEqual([
      { type: "win", text: "Strong" },
      { type: "risk", text: "Risky" },
      { type: "trend", text: "Up" },
      { type: "flag", text: "pain" },
    ]);
    expect(review.themes).toEqual(["stress"]);
    expect(review.coachActions).toEqual([{ priority: "high", text: "Act now" }]);
  });

  it("falls back to ai_recommendations for coach actions on the oldest array shape", () => {
    const checkIn = base({
      aiInsights: [{ type: "strength", text: "Nice" }],
      aiRecommendations: [{ priority: "medium", text: "Adjust" }],
    });

    const review = toCheckInReview(checkIn);
    expect(review.watchItems).toEqual([{ type: "win", text: "Nice" }]);
    expect(review.coachActions).toEqual([{ priority: "medium", text: "Adjust" }]);
  });
});
