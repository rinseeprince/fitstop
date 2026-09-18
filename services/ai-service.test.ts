import { describe, it, expect, vi, beforeEach } from "vitest";

// `vi.hoisted` runs before the hoisted `vi.mock` factory below, which makes
// the mock fn available inside the (hoisted) vi.mock factory.
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create: mockCreate } };
  }
  return { default: OpenAI };
});

import { generateCheckInReview } from "./ai-service";
import { buildCheckInReviewPrompt } from "@/utils/ai-prompt-builder";
import { CHECK_IN_REVIEW_BRIEF } from "@/utils/ai-system-prompt";
import { CHECK_IN_REVIEW_MAX_OUTPUT_TOKENS, CHECK_IN_REVIEW_TIMEOUT_MS } from "@/lib/constants";
import type { CheckInReviewInput } from "@/types/check-in-review-input";

const input = {
  checkIn: { id: "ci-1", clientId: "client-1", createdAt: "2026-09-17T08:30:00Z" },
  clientName: "Jane",
  submittedOn: "2026-09-17",
  viewer: "metric",
  dates: ["2026-09-17"],
  loggedDates: [],
  workouts: [],
  exerciseLines: new Map(),
  nutrition: { days: [], summary: { periodDays: 1, loggedDays: 0, targetedDays: 0, judgedDays: 0, loggedNoTargetDays: 0, onTarget: 0, over: 0, under: 0, daysOnTargetPct: null, targetTotals: null, consumedOnTargetedDays: null, calorieAdherencePct: null, periodVerdict: null, perJudgedDay: null, intakePerLoggedDay: null, netCaloriesOnJudgedDays: null } },
  habits: [],
  dailyLogs: [],
  comparison: null,
} as unknown as CheckInReviewInput;

const review = {
  summary: "A quiet week.",
  watchItems: [{ type: "flag", text: "Nothing logged." }],
  themes: [],
  coachActions: [{ priority: "high", text: "Call them." }],
  clientMessage: "Hi Jane",
};

beforeEach(() => {
  mockCreate.mockReset();
  mockCreate.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(review) } }] });
});

describe("generateCheckInReview", () => {
  it("calls gpt-4o with the brief, the assembled week, the output room and the timeout the constants set", async () => {
    await generateCheckInReview(input);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const [request, options] = mockCreate.mock.calls[0];
    expect(request.model).toBe("gpt-4o");
    expect(request.max_tokens).toBe(CHECK_IN_REVIEW_MAX_OUTPUT_TOKENS);
    expect(request.response_format).toEqual({ type: "json_object" });
    expect(options).toEqual({ timeout: CHECK_IN_REVIEW_TIMEOUT_MS });
    expect(request.messages).toEqual([
      { role: "system", content: CHECK_IN_REVIEW_BRIEF },
      { role: "user", content: buildCheckInReviewPrompt(input) },
    ]);
  });

  it("returns the parsed review", async () => {
    await expect(generateCheckInReview(input)).resolves.toEqual(review);
  });

  it("falls back to the safe review when the model returns something the card cannot render", async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: "not json" } }] });
    const result = await generateCheckInReview(input);
    expect(result.summary).toMatch(/Unable to generate/);
  });

  it("throws, with the cause attached, when the call fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mockCreate.mockRejectedValue(new Error("timeout"));
    await expect(generateCheckInReview(input)).rejects.toThrow("Failed to generate the check-in review");
    error.mockRestore();
  });
});
