import { describe, it, expect } from "vitest";
import { parseCheckInReview, fallbackReview } from "./check-in-review";

describe("parseCheckInReview", () => {
  it("parses a valid review and strips any markdown", () => {
    const json = JSON.stringify({
      summary: "Strong **week** overall.",
      watchItems: [{ type: "win", text: "Hit *protein* target" }],
      themes: ["protein", "sleep"],
      coachActions: [{ priority: "high", text: "Increase **carbs**" }],
      clientMessage: "Nice work **Sam**.",
    });
    const review = parseCheckInReview(json);
    expect(review.summary).toBe("Strong week overall.");
    expect(review.watchItems[0].text).toBe("Hit protein target");
    expect(review.coachActions[0].text).toBe("Increase carbs");
    expect(review.clientMessage).toBe("Nice work Sam.");
    expect(review.themes).toEqual(["protein", "sleep"]);
  });

  it("falls back on invalid JSON", () => {
    expect(parseCheckInReview("not json")).toEqual(fallbackReview());
  });

  it("falls back on a schema mismatch (bad watch type)", () => {
    const json = JSON.stringify({
      summary: "x",
      watchItems: [{ type: "nope", text: "y" }],
      themes: [],
      coachActions: [],
      clientMessage: "z",
    });
    expect(parseCheckInReview(json)).toEqual(fallbackReview());
  });

  it("defaults missing arrays to empty", () => {
    const review = parseCheckInReview(JSON.stringify({ summary: "ok", clientMessage: "hi" }));
    expect(review.watchItems).toEqual([]);
    expect(review.themes).toEqual([]);
    expect(review.coachActions).toEqual([]);
  });
});

describe("parseCheckInReview — no list caps", () => {
  it("keeps a review with more watch items and actions than the old caps allowed", () => {
    const review = {
      summary: "A full week.",
      watchItems: Array.from({ length: 8 }, (_, i) => ({ type: "trend", text: `item ${i + 1}` })),
      themes: Array.from({ length: 7 }, (_, i) => `theme ${i + 1}`),
      coachActions: Array.from({ length: 6 }, (_, i) => ({ priority: "low", text: `action ${i + 1}` })),
      clientMessage: "Hi",
    };
    const parsed = parseCheckInReview(JSON.stringify(review));
    expect(parsed.watchItems).toHaveLength(8);
    expect(parsed.themes).toHaveLength(7);
    expect(parsed.coachActions).toHaveLength(6);
    expect(parsed.summary).toBe("A full week.");
  });
});

describe("parseCheckInReview — the model's working", () => {
  it("drops the analysis the model writes first and keeps the card's parts", () => {
    const parsed = parseCheckInReview(
      JSON.stringify({
        analysis: "Sleep fell on Monday, the Tuesday session was cut short...",
        summary: "Training\nA hard week.\n\nRecovery\nSleep dipped midweek.",
        watchItems: [],
        themes: [],
        coachActions: [],
        clientMessage: "Hi",
      })
    );
    expect(parsed).not.toHaveProperty("analysis");
    expect(parsed.summary).toBe("Training\nA hard week.\n\nRecovery\nSleep dipped midweek.");
  });
});
