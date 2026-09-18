import { sanitizeForAIPrompt } from "@/utils/ai-prompt-sanitizer";

/**
 * The shape the review card renders (`CheckInReview`, parsed by
 * lib/validations/check-in-review.ts): a summary, what to watch with its
 * theme chips, coach actions with a priority each, and the message the Reply
 * box drafts from. Named so the card keeps working; sized by the week, not by
 * a count — there are no item limits here or in the parser. Each part says
 * what depth it carries, because a one-line hint reads as a one-line answer.
 *
 * `analysis` comes first and is never shown: the model writes its working
 * before its conclusions, which is the cheapest way to get reasoned depth out
 * of a single JSON-mode call. The parser drops the key.
 */
export function describeReviewShape(clientName: string): string {
  const safeName = sanitizeForAIPrompt(clientName);
  return `Return a JSON object with exactly these keys, in this order, and nothing else:
{
  "analysis": "your working, written first: think the week through here day by day and measure by measure before you write anything else; the coach never sees this field",
  "summary": "the full report, in several paragraphs under short plain section lines: what happened, what is most likely driving it and why, how the days and measures connect, and what you expect next week if nothing changes",
  "watchItems": [{ "type": "win | risk | trend | flag", "text": "the observation, its likely cause, and what it connects to" }],
  "themes": ["a short phrase in the client's own words"],
  "coachActions": [{ "priority": "high | medium | low", "text": "what to do, why, and how to raise it with the client" }],
  "clientMessage": "a message to ${safeName}, as long as it needs to be, ready to send"
}
Use as many items as the week warrants, or none.`;
}
