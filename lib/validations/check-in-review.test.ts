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
