import type { UnplannedActivity } from "@/types/daily-pulse";

export type CalorieFeedback = {
  difference: number;
  direction: "over" | "under" | "exact";
  colour: "green" | "amber" | "red";
};

export type MacroCalculationResult = {
  proteinG: number;
  carbsG: number;
  fatG: number;
};

export type NutritionAdherence = "hit" | "partial" | "missed";

const CALORIE_THRESHOLDS = {
  GREEN_MAX: 50,
  AMBER_MAX: 200
};

const MET_VALUES = {
  low: 3.5,
  moderate: 6.0,
  vigorous: 8.5
};

const AVERAGE_WEIGHT_KG = 70;

export function calculateUnplannedActivityCalories(activity: UnplannedActivity): number {
  const metValue = MET_VALUES[activity.intensityLevel];
  return Math.round((metValue * AVERAGE_WEIGHT_KG * activity.durationMinutes) / 60);
}

export function calculateAdjustedDayTarget(
  baselineCalories: number,
  completedTrainingCals: number,
  completedActivityCals: number
): number {
  return baselineCalories + completedTrainingCals + completedActivityCals;
}

export function calculateAdjustedMacros(
  adjustedCalories: number,
  baseProteinG: number,
  baseCarbsG: number,
  baseFatG: number
): MacroCalculationResult {
  // Protein stays fixed
  const proteinCal = baseProteinG * 4;
  const baseCarbsCal = baseCarbsG * 4;
  const baseFatCal = baseFatG * 9;
  const baseNonProteinCal = baseCarbsCal + baseFatCal;
  
  if (baseNonProteinCal === 0) {
    return {
      proteinG: baseProteinG,
      carbsG: 0,
      fatG: 0
    };
  }
  
  // Calculate remaining calories after protein (which stays fixed)
  const remainingCal = Math.max(0, adjustedCalories - proteinCal);
  
  // Preserve the carb/fat ratio from the original plan
  const carbRatio = baseCarbsCal / baseNonProteinCal;
  const newCarbsCal = remainingCal * carbRatio;
  const newFatCal = remainingCal * (1 - carbRatio);
  
  return {
    proteinG: Math.round(baseProteinG),
    carbsG: Math.round(newCarbsCal / 4),
    fatG: Math.round(newFatCal / 9)
  };
}

export function getCalorieFeedback(consumed: number | null, target: number): CalorieFeedback {
  if (consumed === null || consumed === undefined) {
    return {
      difference: target,
      direction: "under",
      colour: "green"
    };
  }
  
  const difference = Math.abs(consumed - target);
  const direction = consumed > target ? "over" : consumed < target ? "under" : "exact";
  
  let colour: "green" | "amber" | "red";
  if (difference <= CALORIE_THRESHOLDS.GREEN_MAX) {
    colour = "green";
  } else if (difference <= CALORIE_THRESHOLDS.AMBER_MAX) {
    colour = "amber";
  } else {
    colour = "red";
  }
  
  return {
    difference,
    direction,
    colour
  };
}

export function getNutritionAdherence(consumed: number | null, target: number): NutritionAdherence | null {
  if (consumed === null || consumed === undefined || target === 0) {
    return null;
  }
  
  const difference = Math.abs(consumed - target);
  
  if (difference <= CALORIE_THRESHOLDS.GREEN_MAX) return "hit";
  if (difference <= CALORIE_THRESHOLDS.AMBER_MAX) return "partial";
  return "missed";
}

export function getFeedbackText(feedback: CalorieFeedback, isCalories: boolean = false): string {
  if (feedback.direction === "exact") {
    return "Perfect!";
  }
  const prefix = feedback.direction === "over" ? "+" : "-";
  const value = feedback.difference;
  const unit = isCalories ? " cal" : "g";
  const suffix = feedback.direction === "over" ? " over target" : " under target";
  return `${prefix}${value}${unit}${suffix}`;
}

export function getFeedbackColor(colour: string): string {
  switch (colour) {
    case "green": return "text-green-600";
    case "amber": return "text-amber-600";
    case "red": return "text-red-600";
    default: return "text-muted-foreground";
  }
}