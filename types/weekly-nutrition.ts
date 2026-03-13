export type WeeklyAdherenceStatus = "hit" | "partial" | "missed";

export type WeeklyNutritionSummary = {
  id: string;
  clientId: string;
  weekStartDate: string;
  weekEndDate: string;

  // Targets (summed from daily targets for logged days)
  totalTargetCalories: number;
  totalTargetProteinG: number | null;
  totalTargetCarbsG: number | null;
  totalTargetFatG: number | null;

  // Actuals (summed from daily consumed)
  totalCaloriesConsumed: number | null;
  totalProteinConsumedG: number | null;
  totalCarbsConsumedG: number | null;
  totalFatConsumedG: number | null;

  // Calculated
  calorieDifference: number | null;
  adherencePercentage: number | null;
  weeklyAdherence: WeeklyAdherenceStatus | null;

  // Day counts
  daysInWeek: number;
  daysLogged: number;
  daysOnTarget: number;
  daysOver: number;
  daysUnder: number;

  createdAt: string;
  updatedAt: string;
};
