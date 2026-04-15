import type { TrainingPlan } from "@/types/training";

/**
 * Get training sessions summary for a day (name and calories)
 */
export const getTrainingSessionsSummary = (
  plan: TrainingPlan | null,
  day: string
): Array<{ name: string; calories: number }> => {
  if (!plan) return [];

  return plan.sessions
    .filter(
      (session) =>
        session.sessionType === "training" &&
        session.dayOfWeek?.toLowerCase() === day.toLowerCase()
    )
    .map((session) => ({
      name: session.name,
      calories: session.estimatedCalories || 0,
    }));
};
