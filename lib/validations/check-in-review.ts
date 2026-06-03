import { z } from "zod";
import type { CheckInReview } from "@/types/check-in";
import { stripInlineMarkdown } from "@/lib/check-in/markdown";

// Schema for the v3 AI coach review. The model is asked to return exactly this
// shape as JSON; anything that fails validation falls back to a safe default so
// the rail always renders. Plain-text output plus the strip below means no
// markdown can leak into any field.
const watchItemSchema = z.object({
  type: z.enum(["win", "risk", "trend", "flag"]),
  text: z.string().min(1),
});

const coachActionSchema = z.object({
  priority: z.enum(["high", "medium", "low"]),
  text: z.string().min(1),
});

export const checkInReviewSchema = z.object({
  summary: z.string(),
  watchItems: z.array(watchItemSchema).max(6).default([]),
  themes: z.array(z.string().min(1)).max(6).default([]),
  coachActions: z.array(coachActionSchema).max(5).default([]),
  clientMessage: z.string(),
});

// Defensive plain-text pass over every string field. The v3 prompt returns plain
// text, but this guarantees no stray markdown survives even if the model slips.
function sanitiseReview(review: CheckInReview): CheckInReview {
  return {
    summary: stripInlineMarkdown(review.summary),
    watchItems: review.watchItems.map((w) => ({ ...w, text: stripInlineMarkdown(w.text) })),
    themes: review.themes.map((t) => stripInlineMarkdown(t)),
    coachActions: review.coachActions.map((a) => ({ ...a, text: stripInlineMarkdown(a.text) })),
    clientMessage: stripInlineMarkdown(review.clientMessage),
  };
}

export function fallbackReview(): CheckInReview {
  return {
    summary: "Unable to generate a review automatically. Please review this check-in manually.",
    watchItems: [],
    themes: [],
    coachActions: [
      { priority: "high", text: "Review the check-in manually and reply to the client." },
    ],
    clientMessage:
      "Thanks for checking in this week. I have reviewed your update and will follow up with detailed feedback shortly.",
  };
}

// Parse a model response (expected JSON) into a validated, sanitised review.
// Returns the fallback review on malformed JSON or schema mismatch.
export function parseCheckInReview(responseText: string): CheckInReview {
  try {
    const json: unknown = JSON.parse(responseText);
    const parsed = checkInReviewSchema.safeParse(json);
    if (parsed.success) {
      return sanitiseReview(parsed.data);
    }
  } catch {
    // fall through to the safe default below
  }
  return fallbackReview();
}
