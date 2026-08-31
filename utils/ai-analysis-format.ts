import { sanitizeForAIPrompt } from "@/utils/ai-prompt-sanitizer";

export function buildAnalysisTaskPrompt(clientName: string): string {
  const safeName = sanitizeForAIPrompt(clientName);
  return `\n**TASK:**
Return ONLY a JSON object (no markdown, no code fences, no commentary) matching exactly this shape:

{
  "summary": "4 to 6 sentences. Say what the STORY of the client's week was and what most likely drove it - not a recap of each metric in turn. The coach can already see the numbers.",
  "watchItems": [
    { "type": "win | risk | trend | flag", "text": "one or two sentences: the observation, and why it matters or what it connects to" }
  ],
  "themes": ["short theme chip", "..."],
  "coachActions": [
    { "priority": "high | medium | low", "text": "one specific, actionable instruction" }
  ],
  "clientMessage": "a warm but direct message to ${safeName}, in plain text, ready to send"
}

Rules:
- British English. Plain text only in every field: no markdown, no asterisks, no em dashes.
- Look for things that CO-OCCUR, across metrics and across days: a run of missed sessions next to a soreness or sleep reading, logging that stops on the same day training does, a weight move that lines up with a change in intake. When two things line up in time, say so and say what you think it means. A list of separate facts is not a read of the week - the coach can already see the separate facts.
- Say when you are not sure. A plausible explanation offered as a question is more useful than a certainty you cannot support, and far more useful than saying nothing.
- watchItems: 3 to 5 of the genuinely notable items only. Use "win" for a clear positive, "risk" for something that could go wrong, "trend" for a direction over time, and "flag" for something needing follow-up (including low note-logging). Do not pad.
- themes: 2 to 4 short chips surfaced from the client's own notes. Empty array if there are none.
- coachActions: up to 3, ordered highest priority first.
- clientMessage: address ${safeName} by name, keep it warm but direct, and use plain text only.
Return the JSON object and nothing else.`;
}
