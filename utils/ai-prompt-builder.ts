import type { CheckInWithDetails, CheckIn } from "@/types/check-in";
import type { DailyLog } from "@/types/daily-log";
import type { HabitLogWithDetails } from "@/types/daily-habit";
import type { WeeklyNutritionSummary } from "@/types/weekly-nutrition";
import { buildDailyContextForAI } from "@/utils/ai-daily-context-builder";
import { sanitizeForAIPrompt } from "@/utils/ai-prompt-sanitizer";

export const AI_SYSTEM_PROMPT = `You are an elite data analyst with decades of experience reviewing body/performance metrics and being able to join the dots together from data to provide highly relevant insights and paint an incredible picture of what the data says across all sports science. You are helping a fitness coach review their client's weekly check-in. Analyse the data and client notes to provide the coach with actionable insights.

ANALYSIS FRAMEWORK:

WEEKLY NUTRITION OVERVIEW: Assess against weekly targets, but take daily targets into context. Highlight intelligent calorie management (banking, redistributing). Frame nutrition through a weekly lens, not daily.

CLIENT NOTES ANALYSIS: Read all daily notes. Identify:
- Forward planning (banking calories for events)
- Explanations for deviations (and whether the data supports them)
- Emotional state or stress indicators
- Training/physical concerns mentioned
- Lifestyle factors affecting adherence

TRAINING & HABITS: Completion rates and any patterns.

WELLNESS TRENDS: Mood, energy, sleep, stress patterns across the week.

COACH RECOMMENDATIONS: Specific, actionable suggestions.

EDGE CASE HANDLING:
- If no daily notes exist, mention that encouraging the client to log notes would improve coaching insights.
- If only 1-2 days have notes, flag the low logging frequency as something the coach should follow up on.
- If notes mention restriction, extreme dieting, bingeing, or disordered eating, flag sensitively under concerns.
- If notes mention persistent pain, injury, or inability to perform exercises, flag prominently under concerns and add an urgent coach action.

Be concise. Lead with the most important insight. Use the client's own words from their notes where relevant. Frame everything through a weekly lens, not daily.`;

export function buildCheckInAnalysisPrompt(
  current: CheckInWithDetails,
  previous: CheckIn[],
  clientName: string,
  dailyLogs?: DailyLog[],
  habitLogs?: HabitLogWithDetails[],
  startDate?: Date,
  endDate?: Date,
  weeklySummary?: WeeklyNutritionSummary | null
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
  if (current.sessionCompletions?.length) {
    const completed = current.sessionCompletions.filter((s) => s.completed).length;
    const total = current.sessionCompletions.length;
    prompt += `- Sessions: ${completed}/${total} completed\n`;
    current.sessionCompletions.forEach((s) => {
      const status = s.completed
        ? s.completionQuality === "partial" ? "(partial)" : "(full)"
        : "(skipped)";
      prompt += `  - ${sanitizeForAIPrompt(s.sessionName)}: ${status}\n`;
      if (s.notes) prompt += `    Note: ${sanitizeForAIPrompt(s.notes)}\n`;
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
      prompt += `- Weekly adherence: ${weeklySummary.weeklyAdherence ?? "unknown"} (${weeklySummary.adherencePercentage?.toFixed(1) ?? "?"}%)\n`;
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

  if (current.externalActivities?.length) {
    prompt += "\nExternal Activities (outside training plan):\n";
    current.externalActivities.forEach((a) => {
      prompt += `- ${sanitizeForAIPrompt(a.activityName)}: ${a.durationMinutes}min (${a.intensityLevel})`;
      if (a.estimatedCalories) prompt += ` ~${a.estimatedCalories}cal`;
      prompt += "\n";
    });
  }

  if (current.prs) prompt += `\nPersonal Records (free text): ${sanitizeForAIPrompt(current.prs)}\n`;
  if (current.challenges) prompt += `\nChallenges (free text): ${sanitizeForAIPrompt(current.challenges)}\n`;
  if (current.notes) prompt += `\nNotes: ${sanitizeForAIPrompt(current.notes)}\n`;

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

  prompt += `\n**TASK:**
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

  return prompt;
}
