import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/ai-service", () => ({ generateCheckInReview: vi.fn() }));
vi.mock("@/services/check-in-service", () => ({ updateCheckInAISummary: vi.fn() }));
vi.mock("@/services/check-in-review-input-service", () => ({ getCheckInReviewInput: vi.fn() }));

import { triggerAISummaryGeneration } from "./client-check-in-service";
import { generateCheckInReview } from "@/services/ai-service";
import { updateCheckInAISummary } from "@/services/check-in-service";
import { getCheckInReviewInput } from "@/services/check-in-review-input-service";

const input = { checkIn: { id: "ci-1" }, clientName: "Jane" };
const review = { summary: "s", watchItems: [], themes: [], coachActions: [], clientMessage: "m" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(getCheckInReviewInput).mockResolvedValue(input as never);
  vi.mocked(generateCheckInReview).mockResolvedValue(review);
  vi.mocked(updateCheckInAISummary).mockResolvedValue(undefined);
});

describe("triggerAISummaryGeneration — the review written at submit", () => {
  it("builds the same input the coach's Regenerate builds, generates and stores the review", async () => {
    await triggerAISummaryGeneration("ci-1");
    expect(getCheckInReviewInput).toHaveBeenCalledWith("ci-1");
    expect(generateCheckInReview).toHaveBeenCalledWith(input);
    expect(updateCheckInAISummary).toHaveBeenCalledWith("ci-1", review);
  });

  it("throws when the check-in cannot be found", async () => {
    vi.mocked(getCheckInReviewInput).mockResolvedValue(null);
    await expect(triggerAISummaryGeneration("ci-1")).rejects.toThrow("Check-in not found");
    expect(generateCheckInReview).not.toHaveBeenCalled();
  });

  it("lets a generation failure reach the caller, storing nothing", async () => {
    vi.mocked(generateCheckInReview).mockRejectedValue(new Error("model down"));
    await expect(triggerAISummaryGeneration("ci-1")).rejects.toThrow("model down");
    expect(updateCheckInAISummary).not.toHaveBeenCalled();
  });
});
