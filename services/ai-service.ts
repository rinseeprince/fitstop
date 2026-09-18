import OpenAI from "openai";
import type { CheckInReview } from "@/types/check-in";
import type { CheckInReviewInput } from "@/types/check-in-review-input";
import { CHECK_IN_REVIEW_BRIEF } from "@/utils/ai-system-prompt";
import { buildCheckInReviewPrompt } from "@/utils/ai-prompt-builder";
import { parseCheckInReview } from "@/lib/validations/check-in-review";
import {
  CHECK_IN_REVIEW_MAX_OUTPUT_TOKENS,
  CHECK_IN_REVIEW_TIMEOUT_MS,
} from "@/lib/constants";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * One check-in review: the brief as the system message, the week as the user
 * message, gpt-4o (CONVENTIONS §11), parsed into the shape the card renders.
 * The input is `getCheckInReviewInput`'s, whichever path asked — the client's
 * submit and the coach's Regenerate call this with the same thing.
 */
export const generateCheckInReview = async (
  input: CheckInReviewInput
): Promise<CheckInReview> => {
  try {
    const completion = await openai.chat.completions.create(
      {
        model: "gpt-4o",
        messages: [
          { role: "system", content: CHECK_IN_REVIEW_BRIEF },
          { role: "user", content: buildCheckInReviewPrompt(input) },
        ],
        temperature: 0.7,
        max_tokens: CHECK_IN_REVIEW_MAX_OUTPUT_TOKENS,
        response_format: { type: "json_object" },
      },
      { timeout: CHECK_IN_REVIEW_TIMEOUT_MS }
    );

    const responseText = completion.choices[0]?.message?.content || "";
    return parseCheckInReview(responseText);
  } catch (error) {
    console.error(
      "Error generating the check-in review:",
      error instanceof Error ? error.message : "Unknown error"
    );
    throw new Error("Failed to generate the check-in review", { cause: error });
  }
};
