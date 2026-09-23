import type { GoalOnDay } from "@/types/client-goals";
import type { NutritionCalcInputs } from "@/services/nutrition-calc-inputs";
import type { NutritionOutOfDate } from "@/lib/nutrition/nutrition-out-of-date";

// The two coach reads of how nutrition follows the goal
// (docs/MEASUREMENT-LOG-PLAN.md §6 commit 8d1), both under
// `/api/clients/[id]/nutrition/goal` — one area, one clearer
// (`hooks/use-nutrition-goal.ts`).

/** `GET …/nutrition/goal?date=` — the drawer's Starts on day. */
export type NutritionGoalForDay = {
  date: string;
  /** The goal in force on `date`, with that day's deadline; null = none. */
  goal: GoalOnDay | null;
  /** The calculator's inputs for that goal — what the preview and the save price. */
  calcInputs: NutritionCalcInputs;
};

/** `GET …/nutrition/goal/out-of-date` — the one rule's answer. */
export type NutritionOutOfDateRead = {
  clientToday: string;
  /** The earliest version day, today onward, whose goal is not the one it was
   *  built for; null when every version is up to date. */
  outOfDate: NutritionOutOfDate | null;
};
