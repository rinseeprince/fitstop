import { getNutritionEventsForDateRange } from "./nutrition-days-service";
import {
  deleteNutritionDayEdits,
  upsertNutritionDayEdits,
  type NutritionDayEdit,
} from "./nutrition-day-edits-service";
import { calculateDailyMacros } from "@/utils/nutrition-helpers";
import type { DietType, NutritionEvent } from "@/types/check-in";

/**
 * Coach per-day nutrition edits, on the edits table (migration 169).
 *
 * A range edit resolves the coach's numbers for each selected day against
 * the day AS COMPUTED — the plan's baseline, the session's surplus, an edit
 * already standing — and writes one edit row per day. A computed day with an
 * edit takes those numbers verbatim, carries the note, and takes no training
 * surplus (`services/nutrition-day-resolver.ts`). A reset removes the rows,
 * and the plan's own numbers answer again; nothing regenerates.
 *
 * Both paths are today-forward only — past days are immutable. The routes
 * reject an all-past selection; the service additionally floors the list at
 * clientToday. A selected day no version covers has no computed day and is
 * skipped: there is no target to edit.
 */

// `note` semantics (D-B): undefined = preserve any existing note; "" (or
// whitespace) = clear it; a string = set it. The dialog sends a value only for
// the day(s) the coach actually typed on, so a macro-only edit never wipes notes.
export type RangeEdit =
  | { mode: "absolute"; calories: number; proteinG?: number; carbG?: number; fatG?: number; note?: string | null }
  | { mode: "delta"; percent?: number; calorieDelta?: number; holdProtein?: boolean; note?: string | null };

/** The calorie number a coach currently sees for a day (mirrors
 * `buildNutritionSummary`): surplus stacks on the baseline when set, otherwise
 * the legacy training-burn add-on applies. An edited day has neither, so its
 * base is the edit's own calories. */
function currentDisplayedCalories(day: NutritionEvent): number {
  if (day.calorieSurplusPercentage != null) {
    return Math.round(day.baselineCalories * (1 + day.calorieSurplusPercentage / 100));
  }
  return day.baselineCalories + day.trainingBurnCalories;
}

/** The edit row a coach's instruction resolves to over one computed day. */
function resolveEdit(day: NutritionEvent, edit: RangeEdit): NutritionDayEdit {
  // Resolve the day's new calorie total.
  let calories: number;
  if (edit.mode === "absolute") {
    calories = edit.calories;
  } else {
    const base = currentDisplayedCalories(day);
    const scaled = edit.percent != null ? base * (1 + edit.percent / 100) : base;
    // Floor at zero: an oversized negative delta must never materialize
    // negative calories/macros onto the client's calendar.
    calories = Math.max(0, Math.round(scaled + (edit.calorieDelta ?? 0)));
  }

  // Macros: explicit macros win; otherwise hold protein and rebalance carbs/fat
  // to the new calorie total (D4 "macros auto-rebalance, protein fixed").
  let proteinG: number;
  let carbG: number;
  let fatG: number;
  if (edit.mode === "absolute" && edit.proteinG != null && edit.carbG != null && edit.fatG != null) {
    proteinG = edit.proteinG;
    carbG = edit.carbG;
    fatG = edit.fatG;
  } else if (edit.mode === "delta" && edit.holdProtein === false) {
    // Scale the day's macro SPLIT onto the new total (protein not held).
    // Ratio-of-new-total, not old-total scaling: on a surplus day the macros
    // sum to the baseline while the delta base is the stacked total, so
    // old-ratio scaling would not sum to the new calories.
    const p4 = day.proteinG * 4;
    const c4 = day.carbG * 4;
    const f9 = day.fatG * 9;
    const macroCals = p4 + c4 + f9;
    if (macroCals > 0) {
      proteinG = Math.round((calories * (p4 / macroCals)) / 4);
      carbG = Math.round((calories * (c4 / macroCals)) / 4);
      fatG = Math.round((calories * (f9 / macroCals)) / 9);
    } else {
      const macros = calculateDailyMacros(calories, day.proteinG, false, (day.dietType as DietType) || "balanced");
      proteinG = macros.proteinG;
      carbG = macros.carbsG;
      fatG = macros.fatG;
    }
  } else {
    const fixedProtein = edit.mode === "absolute" && edit.proteinG != null ? edit.proteinG : day.proteinG;
    const macros = calculateDailyMacros(calories, fixedProtein, false, (day.dietType as DietType) || "balanced");
    proteinG = macros.proteinG;
    carbG = macros.carbsG;
    fatG = macros.fatG;
  }

  // D-B: the day's standing note survives an edit that carries none;
  // "" / whitespace clears it; text sets it.
  const note =
    edit.note === undefined
      ? day.note
      : edit.note && edit.note.trim() !== ""
        ? edit.note.trim()
        : null;

  return { date: day.date, calories, proteinG, carbG, fatG, note };
}

type MaterializeParams = {
  clientId: string;
  /** The editing coach — the audit actor on each edit row. */
  coachId: string;
  dates: string[];
  edit: RangeEdit;
  clientToday: string;
};

/**
 * Write the coach's edit onto an explicit LIST of future days (any arrangement
 * — single, scattered, or contiguous). The computed days are read once over the
 * selection's span; only the selected dates are written, so a scattered
 * selection edits exactly the chosen days and leaves the gaps untouched. One
 * upsert for the whole list. Returns the days written.
 */
export async function materializeNutritionEventDays({
  clientId,
  coachId,
  dates,
  edit,
  clientToday,
}: MaterializeParams): Promise<{ updated: number }> {
  // Keep only today-forward dates (defensive — the route also filters); a past
  // day is never written.
  const eligible = new Set(dates.filter((d) => d >= clientToday));
  if (eligible.size === 0) return { updated: 0 };

  const sorted = [...eligible].sort();
  const days = (
    await getNutritionEventsForDateRange(clientId, sorted[0], sorted[sorted.length - 1])
  ).filter((day) => eligible.has(day.date));
  if (days.length === 0) return { updated: 0 };

  const edits = days.map((day) => resolveEdit(day, edit));
  await upsertNutritionDayEdits(clientId, coachId, edits);

  return { updated: edits.length };
}

type ResetParams = {
  clientId: string;
  dates: string[];
  clientToday: string;
};

/**
 * Remove the edits on a LIST of future days in one statement, so the plan's
 * own numbers answer for them again. A scattered selection resets exactly the
 * chosen days. Returns the days that held an edit.
 */
export async function resetNutritionEventDays({
  clientId,
  dates,
  clientToday,
}: ResetParams): Promise<{ reset: number }> {
  const eligibleDates = dates.filter((d) => d >= clientToday);
  if (eligibleDates.length === 0) return { reset: 0 };

  const reset = await deleteNutritionDayEdits(clientId, eligibleDates);
  return { reset };
}
