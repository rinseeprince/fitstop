import type {
  AICheckInSummary,
  AIInsight,
  AIRecommendation,
  AINutritionInsight,
  AINotesIntelligence,
  AITrainingInsight,
  AIWellnessInsight,
  AICoachAction,
} from "@/types/check-in";

function extractSection(text: string, sectionName: string, nextSections: string[]): string {
  const endPattern = nextSections.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const regex = new RegExp(`${sectionName}:\\s*([\\s\\S]*?)(?=${endPattern}|$)`, "i");
  const match = text.match(regex);
  return match?.[1]?.trim() || "";
}

function parseFieldLine(text: string, field: string): string {
  const regex = new RegExp(`\\[${field}\\]\\s*(.+)`, "i");
  const match = text.match(regex);
  return match?.[1]?.trim() || "";
}

function parsePipeSeparated(value: string): string[] {
  if (!value || value.toLowerCase() === "none") return [];
  return value.split("|").map((s) => s.trim()).filter(Boolean);
}

const ALL_SECTIONS = [
  "SUMMARY:", "NUTRITION_INSIGHT:", "NOTES_INTELLIGENCE:", "TRAINING_INSIGHT:",
  "WELLNESS_INSIGHT:", "COACH_ACTIONS:", "CLIENT_HIGHLIGHTS:", "INSIGHTS:",
  "RECOMMENDATIONS:", "RESPONSE_DRAFT:",
];

function parseNutritionInsight(text: string): AINutritionInsight | undefined {
  const section = extractSection(text, "NUTRITION_INSIGHT", ALL_SECTIONS);
  if (!section) return undefined;
  const weeklyAdherence = parseFieldLine(section, "weekly_adherence");
  const caloriePattern = parseFieldLine(section, "calorie_pattern");
  const keyObservation = parseFieldLine(section, "key_observation");
  if (!weeklyAdherence && !caloriePattern && !keyObservation) return undefined;
  return { weeklyAdherence, caloriePattern, keyObservation };
}

function parseNotesIntelligence(text: string): AINotesIntelligence | undefined {
  const section = extractSection(text, "NOTES_INTELLIGENCE", ALL_SECTIONS);
  if (!section) return undefined;
  const themes = parsePipeSeparated(parseFieldLine(section, "themes"));
  const concerns = parsePipeSeparated(parseFieldLine(section, "concerns"));
  const positives = parsePipeSeparated(parseFieldLine(section, "positives"));
  if (themes.length === 0 && concerns.length === 0 && positives.length === 0) return undefined;
  // rawNotes are populated from daily logs, not from AI response
  return { themes, concerns, positives, rawNotes: [] };
}

function parseTrainingInsight(text: string): AITrainingInsight | undefined {
  const section = extractSection(text, "TRAINING_INSIGHT", ALL_SECTIONS);
  if (!section) return undefined;
  const completionSummary = parseFieldLine(section, "completion");
  const keyObservation = parseFieldLine(section, "observation");
  const progressNote = parseFieldLine(section, "progress");
  if (!completionSummary && !keyObservation && !progressNote) return undefined;
  return { completionSummary, keyObservation, progressNote };
}

function parseWellnessInsight(text: string): AIWellnessInsight | undefined {
  const section = extractSection(text, "WELLNESS_INSIGHT", ALL_SECTIONS);
  if (!section) return undefined;
  const pattern = parseFieldLine(section, "pattern");
  const averages = parseFieldLine(section, "averages");
  const concernText = parseFieldLine(section, "concern");
  if (!pattern && !averages) return undefined;
  return {
    pattern,
    averages,
    concern: concernText && concernText.toLowerCase() !== "none" ? concernText : undefined,
  };
}

function parseCoachActions(text: string): AICoachAction[] | undefined {
  const section = extractSection(text, "COACH_ACTIONS", ALL_SECTIONS);
  if (!section) return undefined;
  const actions: AICoachAction[] = [];
  const urgencies: Array<"now" | "next_check_in" | "monitor"> = ["now", "next_check_in", "monitor"];
  for (const urgency of urgencies) {
    const line = parseFieldLine(section, urgency);
    if (line) {
      const parts = line.split("|").map((s) => s.trim());
      actions.push({ action: parts[0], urgency, context: parts[1] || "" });
    }
  }
  return actions.length > 0 ? actions : undefined;
}

function parseClientHighlights(text: string): string[] | undefined {
  const section = extractSection(text, "CLIENT_HIGHLIGHTS", ALL_SECTIONS);
  if (!section) return undefined;
  const highlights = section
    .split("\n")
    .map((l) => l.replace(/^-\s*/, "").trim())
    .filter(Boolean);
  return highlights.length > 0 ? highlights : undefined;
}

function parseLegacyInsights(text: string): AIInsight[] {
  const section = extractSection(text, "INSIGHTS", ALL_SECTIONS);
  if (!section) return [];
  const insights: AIInsight[] = [];
  section.split("\n").forEach((line) => {
    const match = line.match(/\[(strength|concern|trend)\]\s*(.+)/i);
    if (match) {
      insights.push({
        type: match[1].toLowerCase() as "strength" | "concern" | "trend",
        text: match[2].trim(),
      });
    }
  });
  return insights;
}

function parseLegacyRecommendations(text: string): AIRecommendation[] {
  const section = extractSection(text, "RECOMMENDATIONS", ALL_SECTIONS);
  if (!section) return [];
  const recs: AIRecommendation[] = [];
  section.split("\n").forEach((line) => {
    const match = line.match(/\[(high|medium|low)\]\s*(.+)/i);
    if (match) {
      recs.push({
        priority: match[1].toLowerCase() as "high" | "medium" | "low",
        text: match[2].trim(),
      });
    }
  });
  return recs;
}

export function parseAIResponse(responseText: string): AICheckInSummary {
  const summaryText = extractSection(responseText, "SUMMARY", ALL_SECTIONS);
  const insights = parseLegacyInsights(responseText);
  const recommendations = parseLegacyRecommendations(responseText);
  const responseMatch = responseText.match(/RESPONSE_DRAFT:\s*([\s\S]*?)$/i);
  const responseDraft = responseMatch?.[1]?.trim() || "";

  return {
    summary: summaryText || "Unable to generate summary. Please review manually.",
    insights: insights.length > 0 ? insights : [{ type: "concern", text: "AI analysis failed. Manual review required." }],
    recommendations: recommendations.length > 0 ? recommendations : [{ priority: "high", text: "Review check-in manually and provide feedback." }],
    responseDraft: responseDraft || "Great work this week! I've reviewed your check-in and will follow up with detailed feedback soon.",
    nutritionInsight: parseNutritionInsight(responseText),
    notesIntelligence: parseNotesIntelligence(responseText),
    trainingInsight: parseTrainingInsight(responseText),
    wellnessInsight: parseWellnessInsight(responseText),
    coachActions: parseCoachActions(responseText),
    clientHighlights: parseClientHighlights(responseText),
  };
}
