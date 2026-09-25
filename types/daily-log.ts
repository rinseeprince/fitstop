// Daily log types for wellness and nutrition tracking

export type NutritionAdherenceStatus = "hit" | "partial" | "missed";

/**
 * A day of the client's day-form, assembled from its wellness row and its
 * food row (`services/daily-logs-service.ts`). A day has no row of its own:
 * `id` is its date, stable and unique per client, and the stamps are the
 * earliest and latest of the day's rows.
 */
export type DailyLog = {
  id: string; // the date, YYYY-MM-DD
  clientId: string;
  date: string; // ISO date string (YYYY-MM-DD)

  // Subjective metrics
  mood?: number; // 1-5
  energy?: number; // 1-10
  sleep?: number; // 1-10
  stress?: number; // 1-10
  soreness?: number; // 1-10 (higher = more sore)

  // Nutrition tracking
  caloriesConsumed?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  targetCalories?: number;
  targetProteinG?: number;
  targetCarbsG?: number;
  targetFatG?: number;
  nutritionAdherence?: NutritionAdherenceStatus;
  calorieSurplusDeficit?: number;

  // Timestamps
  createdAt: string;
  updatedAt: string;
};
