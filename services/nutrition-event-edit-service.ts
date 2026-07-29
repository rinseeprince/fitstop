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

// `note` semantics (D-B): undefined = preserve any existing note; "" (or
// whitespace) = clear it; a string = set it. The dialog sends a value only for
// the day(s) the coach actually typed on, so a macro-only edit never wipes notes.
export type RangeEdit =
  | { mode: "absolute"; calories: number; proteinG?: number; carbG?: number; fatG?: number; note?: string | null }
  | { mode: "delta"; percent?: number; calorieDelta?: number; holdProtein?: boolean; note?: string | null };

type EligibleRow = {
  id: string;
  baseline_calories: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
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
 * Materialize an absolute or %/amount-delta edit onto an explicit LIST of future
 * scheduled events (any arrangement — single, scattered, or contiguous). A
 * scattered selection edits exactly the chosen days and leaves the gaps
 * untouched (the IN-list, not a [min,max] range). Returns the days updated.
 */
export async function materializeNutritionEventDays(
  clientId: string,
  dates: string[],
  edit: RangeEdit,
  clientToday: string
): Promise<{ updated: number }> {
  // Keep only today-forward dates (defensive — the route also filters); a past
  // row is never written. Only scheduled rows are editable (logged/missed are
  // immutable).
  const eligibleDates = dates.filter((d) => d >= clientToday);
  if (eligibleDates.length === 0) return { updated: 0 };

  const { data: rows, error } = await supabaseAdmin
    .from("nutrition_events")
    .select("id, baseline_calories, protein_g, carb_g, fat_g, training_burn_calories, calorie_surplus_percentage, diet_type")
    .eq("client_id", clientId)
    .eq("status", "scheduled")
    .in("date", eligibleDates);

  if (error) throw error;
  if (!rows || rows.length === 0) return { updated: 0 };

  // D-B: only touch `note` when the edit carries one. undefined -> preserve;
  // "" / whitespace -> clear (null); text -> set.
  const noteUpdate =
    edit.note === undefined
      ? {}
      : { note: edit.note && edit.note.trim() !== "" ? edit.note.trim() : null };

  for (const row of rows as EligibleRow[]) {
    // Resolve the day's new calorie total.
    let calories: number;
    if (edit.mode === "absolute") {
      calories = edit.calories;
    } else {
      const base = currentDisplayedCalories(row);
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
      // Scale the day's stored macro SPLIT onto the new total (protein not
      // held). Ratio-of-new-total, not old-total scaling: on a surplus day the
      // stored macros sum to the baseline while the delta base is the stacked
      // total, so old-ratio scaling would not sum to the new calories.
      const p4 = Number(row.protein_g) * 4;
      const c4 = Number(row.carb_g) * 4;
      const f9 = Number(row.fat_g) * 9;
      const macroCals = p4 + c4 + f9;
      if (macroCals > 0) {
        proteinG = Math.round((calories * (p4 / macroCals)) / 4);
        carbG = Math.round((calories * (c4 / macroCals)) / 4);
        fatG = Math.round((calories * (f9 / macroCals)) / 9);
      } else {
        const macros = calculateDailyMacros(calories, Number(row.protein_g), false, (row.diet_type as DietType) || "balanced");
        proteinG = macros.proteinG;
        carbG = macros.carbsG;
        fatG = macros.fatG;
      }
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
        ...noteUpdate,
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
    .update({ is_modified: false, note: null, updated_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .eq("date", date)
    .eq("status", "scheduled");

  if (error) throw error;

  await regenerateFutureNutritionEvents(clientId, activePlanId, date);
}

/**
 * Reset a LIST of coach-edited days back to auto in one call: clear `is_modified`
 * on every today-forward scheduled day in `dates`, then regenerate forward from
 * the EARLIEST of them (one regen pass re-derives the un-frozen days from the
 * plan; other is_modified/logged days are preserved). Order matters — clear the
 * flags BEFORE regenerating, since the regen delete only removes is_modified=false
 * rows. Returns the days reset.
 */
export async function resetNutritionEventDays(
  clientId: string,
  dates: string[],
  activePlanId: string,
  clientToday: string
): Promise<{ reset: number }> {
  const eligibleDates = dates.filter((d) => d >= clientToday);
  if (eligibleDates.length === 0) return { reset: 0 };

  const { error } = await supabaseAdmin
    .from("nutrition_events")
    .update({ is_modified: false, note: null, updated_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .eq("status", "scheduled")
    .in("date", eligibleDates);

  if (error) throw error;

  const fromDate = eligibleDates.reduce((min, d) => (d < min ? d : min), eligibleDates[0]);
  await regenerateFutureNutritionEvents(clientId, activePlanId, fromDate);

  return { reset: eligibleDates.length };
}
