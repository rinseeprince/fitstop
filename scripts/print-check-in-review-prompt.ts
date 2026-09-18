/**
 * Prints exactly what the check-in AI is given for one check-in — the brief
 * and the assembled week — without calling the model, so the prompt can be
 * read (and the data behind a review checked) at no cost.
 *
 * Usage, from the project root:
 *   set -a; . ./.env.local; set +a; npm run print:check-in-prompt -- <check-in id>
 */
import { getCheckInReviewInput } from "@/services/check-in-review-input-service";
import { buildCheckInReviewPrompt } from "@/utils/ai-prompt-builder";
import { CHECK_IN_REVIEW_BRIEF } from "@/utils/ai-system-prompt";

async function main(): Promise<void> {
  const checkInId = process.argv[2];
  if (!checkInId) {
    console.error("Usage: npm run print:check-in-prompt -- <check-in id>");
    process.exit(1);
  }

  const input = await getCheckInReviewInput(checkInId);
  if (!input) {
    console.error(`No check-in with id ${checkInId}`);
    process.exit(1);
  }

  console.info("=== SYSTEM MESSAGE (the brief) ===\n");
  console.info(CHECK_IN_REVIEW_BRIEF);
  console.info("\n=== USER MESSAGE (the week) ===\n");
  console.info(buildCheckInReviewPrompt(input));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
