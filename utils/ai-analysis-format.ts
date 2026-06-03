import { sanitizeForAIPrompt } from "@/utils/ai-prompt-sanitizer";

export function buildAnalysisTaskPrompt(clientName: string): string {
  const safeName = sanitizeForAIPrompt(clientName);
  return `\n**TASK:**
Return ONLY a JSON object (no markdown, no code fences, no commentary) matching exactly this shape:

{
  "summary": "2 to 3 sentences tying nutrition, training, wellness and notes into the story of the client's week",
  "watchItems": [
    { "type": "win | risk | trend | flag", "text": "one short sentence" }
  ],
  "themes": ["short theme chip", "..."],
  "coachActions": [
    { "priority": "high | medium | low", "text": "one specific, actionable instruction" }
  ],
  "clientMessage": "a warm but direct message to ${safeName}, in plain text, ready to send"
}

Rules:
- British English. Plain text only in every field: no markdown, no asterisks, no em dashes.
- watchItems: 3 to 5 of the genuinely notable items only. Use "win" for a clear positive, "risk" for something that could go wrong, "trend" for a direction over time, and "flag" for something needing follow-up (including low note-logging). Do not pad.
- themes: 2 to 4 short chips surfaced from the client's own notes. Empty array if there are none.
- coachActions: up to 3, ordered highest priority first.
- clientMessage: address ${safeName} by name, keep it warm but direct, and use plain text only.
Return the JSON object and nothing else.`;
}
