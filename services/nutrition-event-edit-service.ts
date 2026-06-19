import { supabaseAdmin } from "./supabase-admin";
import { calculateDailyMacros } from "@/utils/nutrition-helpers";
import type { DietType } from "@/types/check-in";
import { regenerateFutureNutritionEvents } from "@/services/nutrition-event-service";

/**
 * Coach per-day nutrition edits (events-as-SOT overhaul, Session 3 D4 / spec §3).
 *
 * A range edit MATERIALIZES the resolved numbers onto each future nutrition_event
 * (`baseline_calories` + macros set, `calorie_surplus_percentage := NULL`,
 * `training_burn_calories := 0`, `is_modified := true`). The frozen day no longer
 * stacks training surplus, and the cascade preserves it (Session 1 guard).
 * A reset clears the flag and regenerates that day from the plan.
 *
 * Both paths are today-forward only — past/logged days are immutable. The route
 * rejects a past date; the service additionally floors the range at clientToday
 * and only touches `status = 'scheduled'` rows.
 */

export type RangeEdit =
  | { mode: "absolute"; calories: number; proteinG?: number; carbG?: number; fatG?: number }
  | { mode: "delta"; percent?: number; calorieDelta?: number };

type EligibleRow = {
  id: string;
  baseline_calories: number;
  protein_g: number;
  training_burn_calories: number;
  calorie_surplus_percentage: number | null;
  diet_type: string;
};

/** The calorie number a coach currently sees for a scheduled day (mirrors
 * `buildNutritionSummary`): surplus stacks on the baseline when set, otherwise
 * the legacy training-burn add-on applies. */
function currentDisplayedCalories(row: EligibleRow): number {
  if (row.calorie_surplus_percentage != null) {
    return Math.round(row.baseline_calories * (1 + row.calorie_surplus_percentage / 100));
  }
  return row.baseline_calories + row.training_burn_calories;
}

/**
 * Materialize an absolute or %/amount-delta edit onto every future scheduled
 * event in [startDate, endDate]. Returns the number of days updated.
 */
export async function materializeNutritionEventRange(
  clientId: string,
  startDate: string,
  endDate: string,
  edit: RangeEdit,
  clientToday: string
): Promise<{ updated: number }> {
  // Floor the window at clientToday so a range straddling today never writes a
  // past row. Only scheduled rows are editable (logged/missed are immutable).
  const from = startDate > clientToday ? startDate : clientToday;
  if (from > endDate) return { updated: 0 };

  const { data: rows, error } = await supabaseAdmin
    .from("nutrition_events")
    .select("id, baseline_calories, protein_g, training_burn_calories, calorie_surplus_percentage, diet_type")
    .eq("client_id", clientId)
    .eq("status", "scheduled")
    .gte("date", from)
    .lte("date", endDate);

  if (error) throw error;
  if (!rows || rows.length === 0) return { updated: 0 };

  for (const row of rows as EligibleRow[]) {
    // Resolve the day's new calorie total.
    let calories: number;
    if (edit.mode === "absolute") {
      calories = edit.calories;
    } else {
      const base = currentDisplayedCalories(row);
      const scaled = edit.percent != null ? base * (1 + edit.percent / 100) : base;
      calories = Math.round(scaled + (edit.calorieDelta ?? 0));
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
    } else {
      const fixedProtein = edit.mode === "absolute" && edit.proteinG != null ? edit.proteinG : Number(row.protein_g);
      const macros = calculateDailyMacros(calories, fixedProtein, false, (row.diet_type as DietType) || "balanced");
      proteinG = macros.proteinG;
      carbG = macros.carbsG;
      fatG = macros.fatG;
    }

    const { error: updateError } = await supabaseAdmin
      .from("nutrition_events")
      .update({
        baseline_calories: calories,
        protein_g: proteinG,
        carb_g: carbG,
        fat_g: fatG,
        // Freeze the day: training surplus no longer stacks (spec §3).
        calorie_surplus_percentage: null,
        training_burn_calories: 0,
        is_modified: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    if (updateError) throw updateError;
  }

  return { updated: rows.length };
}

/**
 * Reset a coach-edited day back to auto. Clears `is_modified` FIRST (order
 * matters — the regen delete only removes `is_modified=false` rows), then
 * regenerates forward from that date so the now-unfrozen day is re-derived from
 * the plan while other edited/logged days are preserved.
 */
export async function resetNutritionEvent(
  clientId: string,
  date: string,
  activePlanId: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("nutrition_events")
    .update({ is_modified: false, updated_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .eq("date", date)
    .eq("status", "scheduled");

  if (error) throw error;

  await regenerateFutureNutritionEvents(clientId, activePlanId, date);
}
