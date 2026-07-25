import type { DailyLog } from "@/types/daily-log";
import type { HabitLogWithDetails } from "@/types/daily-habit";
import { NUTRITION_ADHERENCE_HIT_THRESHOLD, NUTRITION_ADHERENCE_PARTIAL_THRESHOLD } from "@/lib/constants";
import { sanitizeForAIPrompt } from "@/utils/ai-prompt-sanitizer";
import { buildWeeklyPatterns } from "@/utils/ai-daily-context-patterns";

export function buildDailyContextForAI(
  dailyLogs: DailyLog[],
  habitLogs: HabitLogWithDetails[],
  startDate: Date,
  endDate: Date
): string {
  if (dailyLogs.length === 0) {
    return "";
  }

  // Sort logs by date
  const sortedLogs = [...dailyLogs].sort((a, b) => a.date.localeCompare(b.date));

  // Build date range info
  const totalDays = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  let context = `DAILY TRACKING DATA (${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' })}, ${sortedLogs.length} of ${totalDays} days logged):\n\n`;

  // Daily summaries
  sortedLogs.forEach(log => {
    const date = new Date(log.date);
    const dateStr = date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

    context += `${dateStr}: `;

    // Wellness metrics
    const wellness = [];
    if (log.mood !== undefined) wellness.push(`Mood ${log.mood}`);
    if (log.energy !== undefined) wellness.push(`Energy ${log.energy}`);
    if (log.sleep !== undefined) wellness.push(`Sleep ${log.sleep}`);
    if (log.stress !== undefined) wellness.push(`Stress ${log.stress}`);
    if (log.soreness !== undefined) wellness.push(`Soreness ${log.soreness}`);
    if (wellness.length > 0) context += wellness.join(', ') + '. ';

    // Nutrition
    if (log.caloriesConsumed !== undefined && log.targetCalories) {
      const diff = log.caloriesConsumed - log.targetCalories;
      const status = Math.abs(diff) <= NUTRITION_ADHERENCE_HIT_THRESHOLD ? 'hit' : Math.abs(diff) <= NUTRITION_ADHERENCE_PARTIAL_THRESHOLD ? 'partial' : 'missed';
      context += `Calories: ${log.caloriesConsumed}/${log.targetCalories} (${status}). `;
    } else if (log.caloriesConsumed === undefined && log.targetCalories) {
      context += `Calories: not logged (target ${log.targetCalories}). `;
    }

    // Training
    if (log.trainingData) {
      if (log.trainingData.trainingSessionName) {
        context += `Training: "${sanitizeForAIPrompt(log.trainingData.trainingSessionName)}" ${log.trainingData.sessionCompleted ? 'completed' : 'missed'}`;

        if (log.trainingData.activityStatuses) {
          const activities = Object.values(log.trainingData.activityStatuses);
          const completed = activities.filter(a => a.completed).length;
          context += `, ${completed}/${activities.length} activities done`;

          const skipped = activities.filter(a => !a.completed).map(a => sanitizeForAIPrompt(a.activityName));
          if (skipped.length > 0) {
            context += ` (skipped: ${skipped.join(', ')})`;
          }
        }
        context += '. ';
      } else if (log.trainingData.unplannedActivities?.length) {
        context += `Training: ${log.trainingData.unplannedActivities.length} unplanned activities. `;
      }
    }

    // Habits for this day
    const dayHabits = habitLogs.filter(h => h.date === log.date);
    if (dayHabits.length > 0) {
      const habitStatus = dayHabits.map(h => `${sanitizeForAIPrompt(h.habitName)} ${h.completed ? '\u2713' : '\u2717'}`);
      context += `Habits: ${habitStatus.join(', ')}. `;
    }

    // Daily notes
    if (log.notes) {
      context += `Notes: "${sanitizeForAIPrompt(log.notes, 300)}"`;
    }

    context += '\n';
  });

  // Weekly patterns (extracted to separate module)
  context += buildWeeklyPatterns(sortedLogs, habitLogs, startDate, endDate);

  return context;
}
