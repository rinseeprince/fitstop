/**
 * Client Check-in Processing Service
 * Writes the AI review after a client submits a check-in.
 */

import { generateCheckInReview } from "@/services/ai-service";
import { updateCheckInAISummary } from "@/services/check-in-service";
import { getCheckInReviewInput } from "@/services/check-in-review-input-service";

/**
 * Writes the review for a check-in the client just submitted. Runs after the
 * submit response, independently of it, and throws so the caller can log the
 * failure.
 *
 * The input is `getCheckInReviewInput`'s — the same function the coach's
 * Regenerate calls — so a review written at submit and one regenerated later
 * start from the same week. It resolves the OWNING coach's unit system itself:
 * this path is client-authenticated, but the coach is who reads the review.
 */
export async function triggerAISummaryGeneration(checkInId: string): Promise<void> {
  try {
    const input = await getCheckInReviewInput(checkInId);
    if (!input) {
      throw new Error("Check-in not found");
    }

    const review = await generateCheckInReview(input);
    await updateCheckInAISummary(checkInId, review);
  } catch (error) {
    console.error(`Error in AI summary generation for check-in ${checkInId}:`, error instanceof Error ? error.message : "Unknown error");
    throw error;
  }
}
