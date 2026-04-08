import OpenAI from "openai";
import type {
  CheckIn,
  CheckInWithDetails,
  AICheckInSummary,
} from "@/types/check-in";
import type { DailyLog } from "@/types/daily-log";
import type { HabitLogWithDetails } from "@/types/daily-habit";
import type { WeeklyNutritionSummary } from "@/types/weekly-nutrition";
import type { PeriodSnapshot } from "@/types/schedule";
import { AI_SYSTEM_PROMPT, buildCheckInAnalysisPrompt } from "@/utils/ai-prompt-builder";
import { parseAIResponse } from "@/utils/ai-response-parser";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Populate rawNotes from daily logs into the parsed AI response.
// Trust boundary: rawNotes are rendered in JSX (React escapes HTML) — safe for display.
// Do NOT re-interpolate rawNotes into AI prompts without sanitizeForAIPrompt().
function attachRawNotes(summary: AICheckInSummary, dailyLogs?: DailyLog[]): AICheckInSummary {
  if (!summary.notesIntelligence || !dailyLogs) return summary;
  const rawNotes = dailyLogs
    .filter((l) => l.notes)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((l) => {
      const date = new Date(l.date);
      return {
        date: date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
        note: l.notes!,
      };
    });
  return {
    ...summary,
    notesIntelligence: { ...summary.notesIntelligence, rawNotes },
  };
}

export const generateCheckInSummary = async (
  currentCheckIn: CheckInWithDetails,
  previousCheckIns: CheckIn[],
  clientName: string,
  dailyLogs?: DailyLog[],
  habitLogs?: HabitLogWithDetails[],
  startDate?: Date,
  endDate?: Date,
  weeklySummary?: WeeklyNutritionSummary | null,
  periodSnapshot?: PeriodSnapshot | null
): Promise<AICheckInSummary> => {
  try {
    const prompt = buildCheckInAnalysisPrompt(
      currentCheckIn,
      previousCheckIns,
      clientName,
      dailyLogs,
      habitLogs,
      startDate,
      endDate,
      weeklySummary,
      periodSnapshot
    );

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: AI_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 2000,
    }, { timeout: 25000 });

    const responseText = completion.choices[0]?.message?.content || "";
    const parsed = parseAIResponse(responseText);
    return attachRawNotes(parsed, dailyLogs);
  } catch (error) {
    console.error("Error generating AI summary:", error instanceof Error ? error.message : "Unknown error");
    throw new Error("Failed to generate AI summary", { cause: error });
  }
};

export const regenerateAISummary = async (
  checkIn: CheckIn,
  previousCheckIns: CheckIn[],
  clientName: string,
  focus?: "positive" | "detailed" | "concise",
  dailyLogs?: DailyLog[],
  habitLogs?: HabitLogWithDetails[],
  startDate?: Date,
  endDate?: Date,
  weeklySummary?: WeeklyNutritionSummary | null
): Promise<AICheckInSummary> => {
  try {
    const focusInstructions = {
      positive: "Focus on positive aspects and wins. Be extra encouraging.",
      detailed: "Provide very detailed analysis with specific metrics and comparisons.",
      concise: "Keep analysis brief and to the point. Highlight only key items.",
    };

    const instruction = focus ? focusInstructions[focus] : "";
    const prompt = buildCheckInAnalysisPrompt(
      checkIn, previousCheckIns, clientName,
      dailyLogs, habitLogs, startDate, endDate, weeklySummary
    );
    const modifiedPrompt = instruction ? `${instruction}\n\n${prompt}` : prompt;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: instruction ? `${AI_SYSTEM_PROMPT}\n\n${instruction}` : AI_SYSTEM_PROMPT,
        },
        { role: "user", content: modifiedPrompt },
      ],
      temperature: 0.7,
      max_tokens: 2000,
    }, { timeout: 25000 });

    const responseText = completion.choices[0]?.message?.content || "";
    const parsed = parseAIResponse(responseText);
    return attachRawNotes(parsed, dailyLogs);
  } catch (error) {
    console.error("Error regenerating AI summary:", error instanceof Error ? error.message : "Unknown error");
    throw new Error("Failed to regenerate AI summary", { cause: error });
  }
};
