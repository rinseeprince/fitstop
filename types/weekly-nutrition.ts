export type WeeklyAdherenceStatus = "hit" | "partial" | "missed";

export type WeeklyNutritionSummary = {
  id: string;
  clientId: string;
  weekStartDate: string;
  weekEndDate: string;

  // Targets. Summed over EVERY day of the period since 2026-08-30 (C5, D5.2) —
  // each day's target resolved as a logged day's frozen value, else that date's
  // nutrition event, else the plan's weekday template. It was the logged days'
  // targets alone, which made a client who logged three of seven perfect days
  // read 100% adherent: the four days they skipped counted on neither side of
  // the ratio. Falls back to logged-days-only when the period has no targets at
  // all, since a zero denominator would read as infinite adherence.
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

  // The AVERAGE half of the adherence/average split above. `adherencePercentage`
  // answers "did they do what they were supposed to" and so divides by the WHOLE
  // period; these answer "what was their intake actually like", and an unlogged
  // day is UNKNOWN, not zero — so they divide by the days with data, each against
  // the target that applied on those same days. Both meanings are needed and
  // neither substitutes for the other: a client who logs two of seven perfect
  // days is 34% adherent and 100% on target, and reporting only the first reads
  // as under-eating. All four are null when nothing was logged.
  loggedTargetCalories: number | null;
  loggedDayMeanConsumed: number | null;
  loggedDayMeanTarget: number | null;
  loggedDayAdherencePercentage: number | null;

  // Day counts
  daysInWeek: number;
  daysLogged: number;
  daysOnTarget: number;
  daysOver: number;
  daysUnder: number;

  createdAt: string;
  updatedAt: string;
};
