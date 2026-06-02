import type { CheckInWithDetails, CheckIn, CheckInTrainingEventDetail } from "@/types/check-in";
import type { DailyLog } from "@/types/daily-log";
import type { HabitLogWithDetails } from "@/types/daily-habit";
import type { WeeklyNutritionSummary } from "@/types/weekly-nutrition";
import type { PeriodSnapshot } from "@/types/schedule";
import { buildDailyContextForAI } from "@/utils/ai-daily-context-builder";
import { sanitizeForAIPrompt } from "@/utils/ai-prompt-sanitizer";
import { buildAnalysisTaskPrompt } from "@/utils/ai-analysis-format";

export { AI_SYSTEM_PROMPT } from "@/utils/ai-system-prompt";

export function buildCheckInAnalysisPrompt(
  current: CheckInWithDetails,
  previous: CheckIn[],
  clientName: string,
  dailyLogs?: DailyLog[],
  habitLogs?: HabitLogWithDetails[],
  startDate?: Date,
  endDate?: Date,
  weeklySummary?: WeeklyNutritionSummary | null,
  periodSnapshot?: PeriodSnapshot | null,
  trainingEventDetails?: CheckInTrainingEventDetail[]
): string {
  let prompt = `Analyze this check-in for ${sanitizeForAIPrompt(clientName)}:\n\n`;

  prompt += "**CURRENT CHECK-IN:**\n";
  prompt += `Date: ${new Date(current.createdAt).toLocaleDateString()}\n`;

  if (current.mood || current.energy || current.sleep || current.stress) {
    prompt += "\nSubjective Metrics:\n";
    if (current.mood) prompt += `- Mood: ${current.mood}/5\n`;
    if (current.energy) prompt += `- Energy: ${current.energy}/10\n`;
    if (current.sleep) prompt += `- Sleep: ${current.sleep}/10\n`;
    if (current.stress) prompt += `- Stress: ${current.stress}/10\n`;
  }

  if (current.weight || current.bodyFatPercentage) {
    prompt += "\nBody Metrics:\n";
    if (current.weight)
      prompt += `- Weight: ${current.weight} ${current.weightUnit || "lbs"}\n`;
    if (current.bodyFatPercentage)
      prompt += `- Body Fat: ${current.bodyFatPercentage}%\n`;
  }

  prompt += "\nTraining:\n";
  // Source of truth (Session 6.2): per-event detail derived from training_events
  // (status) left-joined to session_logs (notes/quality). Falls back to the
  // legacy free-text workout count when no event detail is available.
  if (trainingEventDetails?.length) {
    const completed = trainingEventDetails.filter((d) => d.status === "completed").length;
    const total = trainingEventDetails.length;
    prompt += `- Sessions: ${completed}/${total} completed\n`;
    trainingEventDetails.forEach((d) => {
      let status: string;
      if (d.status === "skipped") {
        status = d.notes
          ? `Skipped (reason: ${sanitizeForAIPrompt(d.notes)})`
          : "Skipped";
      } else if (d.logStatus === "not_logged") {
        status = `(${d.status}, not logged)`;
      } else {
        status = `(${d.status})`;
      }
      prompt += `  - ${sanitizeForAIPrompt(d.sessionName)}: ${status}\n`;
      if (d.status !== "skipped" && d.notes) {
        prompt += `    Note: ${sanitizeForAIPrompt(d.notes)}\n`;
      }
    });
  } else if (current.workoutsCompleted) {
    prompt += `- Workouts Completed: ${current.workoutsCompleted}\n`;
  }

  if (current.exerciseHighlights?.length) {
    prompt += "\nExercise Highlights:\n";
    current.exerciseHighlights.forEach((h) => {
      const type = h.highlightType === "pr" ? "PR" : h.highlightType === "struggle" ? "Struggle" : "Note";
      prompt += `- [${type}] ${sanitizeForAIPrompt(h.exerciseName)}`;
      if (h.weightValue) prompt += ` @ ${h.weightValue}${h.weightUnit}`;
      if (h.reps) prompt += ` x ${h.reps}`;
      prompt += "\n";
      if (h.details) prompt += `  ${sanitizeForAIPrompt(h.details)}\n`;
    });
  }

  // Weekly nutrition summary (primary nutrition lens)
  if (weeklySummary) {
    prompt += "\n**WEEKLY NUTRITION SUMMARY:**\n";
    prompt += `- Weekly target: ${weeklySummary.totalTargetCalories} cal\n`;
    if (weeklySummary.totalCaloriesConsumed != null) {
      prompt += `- Weekly consumed: ${weeklySummary.totalCaloriesConsumed} cal\n`;
      prompt += `- Weekly adherence: ${sanitizeForAIPrompt(weeklySummary.weeklyAdherence ?? "unknown")} (${weeklySummary.adherencePercentage?.toFixed(1) ?? "?"}%)\n`;
    }
    prompt += `- Days on target: ${weeklySummary.daysOnTarget}, over: ${weeklySummary.daysOver}, under: ${weeklySummary.daysUnder}\n`;
    prompt += `- Days logged: ${weeklySummary.daysLogged}/${weeklySummary.daysInWeek}\n`;
  } else {
    prompt += "\nNutrition:\n";
    if (current.nutritionDaysOnTarget !== undefined) {
      prompt += `- Days on target: ${current.nutritionDaysOnTarget}/7\n`;
      if (current.nutritionNotes) prompt += `- Notes: ${sanitizeForAIPrompt(current.nutritionNotes)}\n`;
    } else if (current.adherencePercentage !== undefined) {
      prompt += `- Adherence: ${current.adherencePercentage}%\n`;
    }
  }

  if (current.prs) prompt += `\nPersonal Records (free text): ${sanitizeForAIPrompt(current.prs)}\n`;
  if (current.challenges) prompt += `\nChallenges (free text): ${sanitizeForAIPrompt(current.challenges)}\n`;
  if (current.notes) prompt += `\nNotes: ${sanitizeForAIPrompt(current.notes)}\n`;

  // Prefer frozen snapshot for day-by-day detail when available
  if (periodSnapshot) {
    prompt += "\n**DAY-BY-DAY TRAINING SCHEDULE (from snapshot):**\n";
    for (const day of periodSnapshot.training) {
      const planned = day.plannedSessionName ? ` [Planned: ${sanitizeForAIPrompt(day.plannedSessionName)}]` : "";
      const logged = day.loggedSessionName ? ` [Logged: ${sanitizeForAIPrompt(day.loggedSessionName)}]` : "";
      prompt += `- ${day.date} (${day.dayOfWeek}): ${day.status}${planned}${logged}\n`;
    }

    prompt += "\n**DAY-BY-DAY NUTRITION (from snapshot):**\n";
    for (const day of periodSnapshot.nutrition) {
      const target = day.targetCalories != null ? `target=${day.targetCalories}` : "no target";
      const actual = day.actualCalories != null ? `actual=${day.actualCalories}` : "not logged";
      prompt += `- ${day.date} (${day.dayOfWeek}): ${day.status} (${target}, ${actual})\n`;
    }
  }

  if (dailyLogs && dailyLogs.length > 0 && startDate && endDate) {
    const dailyContext = buildDailyContextForAI(dailyLogs, habitLogs || [], startDate, endDate);
    if (dailyContext) {
      prompt += `\n${dailyContext}\n`;
    }
  }

  if (previous.length > 0) {
    prompt += "\n**PREVIOUS CHECK-INS (for trend analysis):**\n";
    previous.slice(0, 3).forEach((prev, idx) => {
      prompt += `\n${idx + 1}. ${new Date(prev.createdAt).toLocaleDateString()}\n`;
      if (prev.weight) prompt += `   Weight: ${prev.weight} ${prev.weightUnit || "lbs"}\n`;
      if (prev.adherencePercentage) prompt += `   Adherence: ${prev.adherencePercentage}%\n`;
      if (prev.workoutsCompleted) prompt += `   Workouts: ${prev.workoutsCompleted}\n`;
      if (prev.mood) prompt += `   Mood: ${prev.mood}/5\n`;
    });
  }

  prompt += buildAnalysisTaskPrompt(clientName);

  return prompt;
}
