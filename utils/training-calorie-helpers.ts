import type { TrainingPlan } from "@/types/training";

/**
 * Calculate total weekly training calories from a plan
 * Includes both training sessions and external activities
 */
export const calculateWeeklyTrainingCalories = (plan: TrainingPlan | null): number => {
  if (!plan) return 0;

  return plan.sessions.reduce((sum, session) => {
    if (session.sessionType === "training") {
      return sum + (session.estimatedCalories || 0);
    }
    if (session.sessionType === "external_activity") {
      return sum + (session.activityMetadata?.estimatedCalories || 0);
    }
    return sum;
  }, 0);
};

/**
 * Calculate daily average training calories from a plan
 */
export const calculateDailyTrainingCalories = (plan: TrainingPlan | null): number => {
  const weekly = calculateWeeklyTrainingCalories(plan);
  return Math.round(weekly / 7);
};

/**
 * Get calorie breakdown by day of week (all activities combined)
 */
export const getTrainingCaloriesByDay = (
  plan: TrainingPlan | null
): Record<string, number> => {
  const byDay: Record<string, number> = {
    monday: 0,
    tuesday: 0,
    wednesday: 0,
    thursday: 0,
    friday: 0,
    saturday: 0,
    sunday: 0,
  };

  if (!plan) return byDay;

  plan.sessions.forEach((session) => {
    const day = session.dayOfWeek?.toLowerCase();
    if (day && day in byDay) {
      if (session.sessionType === "training") {
        byDay[day] += session.estimatedCalories || 0;
      } else if (session.sessionType === "external_activity") {
        byDay[day] += session.activityMetadata?.estimatedCalories || 0;
      }
    }
  });

  return byDay;
};

/**
 * Get training session (non-external activity) calories by day
 */
export const getTrainingSessionCaloriesByDay = (
  plan: TrainingPlan | null
): Record<string, number> => {
  const byDay: Record<string, number> = {
    monday: 0,
    tuesday: 0,
    wednesday: 0,
    thursday: 0,
    friday: 0,
    saturday: 0,
    sunday: 0,
  };

  if (!plan) return byDay;

  plan.sessions.forEach((session) => {
    const day = session.dayOfWeek?.toLowerCase();
    if (day && day in byDay && session.sessionType === "training") {
      byDay[day] += session.estimatedCalories || 0;
    }
  });

  return byDay;
};

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
