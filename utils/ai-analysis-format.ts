import { sanitizeForAIPrompt } from "@/utils/ai-prompt-sanitizer";

export function buildAnalysisTaskPrompt(clientName: string): string {
  return `\n**TASK:**
Provide your analysis in this EXACT format:

SUMMARY:
[2-3 sentence overview tying together nutrition, training, wellness and notes into a story about the client's week]

NUTRITION_INSIGHT:
[weekly_adherence] Assessment against weekly targets, highlighting intelligent calorie management
[calorie_pattern] Pattern of daily intake across the week
[key_observation] Most important nutrition observation for the coach

NOTES_INTELLIGENCE:
[themes] theme1 | theme2 | theme3
[concerns] concern1 | concern2 (or "none")
[positives] positive1 | positive2 (or "none")

TRAINING_INSIGHT:
[completion] Training completion summary
[observation] Key pattern or concern about training
[progress] Progress notes (PRs, improvements, or concerns)

WELLNESS_INSIGHT:
[pattern] Mood/energy/sleep/stress pattern across the week
[averages] Average scores summary
[concern] Wellness concern if any (or "none")

COACH_ACTIONS:
[now] action | context
[next_check_in] action | context
[monitor] action | context

CLIENT_HIGHLIGHTS:
- Positive point the coach can share with the client
- Another positive point

INSIGHTS:
[strength] Key strength insight
[concern] Key concern insight (if any)
[trend] Key trend insight

RECOMMENDATIONS:
[high] Most important recommendation
[medium] Secondary recommendation
[low] Lower priority recommendation

RESPONSE_DRAFT:
[Draft a warm, personalized message to ${sanitizeForAIPrompt(clientName)} acknowledging their progress and addressing any concerns. Keep it conversational and encouraging.]
`;
}
