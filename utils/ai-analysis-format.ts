import { sanitizeForAIPrompt } from "@/utils/ai-prompt-sanitizer";

/**
 * The shape the review card renders (`CheckInReview`, parsed by
 * lib/validations/check-in-review.ts): a summary, what to watch with its
 * theme chips, coach actions with a priority each, and the message the Reply
 * box drafts from. Named so the card keeps working; sized by the week, not by
 * a count — there are no item limits here or in the parser.
 */
export function describeReviewShape(clientName: string): string {
  const safeName = sanitizeForAIPrompt(clientName);
  return `Return a JSON object with exactly these keys and nothing else:
{
  "summary": "what happened this week and what drove it, as prose",
  "watchItems": [{ "type": "win | risk | trend | flag", "text": "one observation and why it matters" }],
  "themes": ["a short phrase in the client's own words"],
  "coachActions": [{ "priority": "high | medium | low", "text": "what the coach should do" }],
  "clientMessage": "a message to ${safeName}, ready to send"
}
Use as many items as the week warrants, or none.`;
}
