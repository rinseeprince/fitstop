/**
 * Schedule Data Service
 * Bulk nutrition queries that feed the nutrition period summary.
 * Used by both the check-in snapshot service and the history APIs.
 * (The training half — plans with weekday sessions, session logs, training
 * logs — was removed in the 2026-08 dead-code sweep, B5: every consumer read
 * only `.plans`, and post-migration-121 sessions carry `day_of_week: null`.)
 */

import { supabaseAdmin } from "./supabase-admin";

// --- Nutrition data types (raw DB rows) ---

export type NutritionPlanWithTargets = {
  id: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  dailyTargets: Array<{
    dayOfWeek: string;
    calories: number;
    proteinG: number;
    carbG: number;
    fatG: number;
  }>;
};

export type NutritionLogRow = {
  date: string;
  caloriesConsumed: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  // Stored targets from log time (includes activity burn if enabled)
  targetCalories: number | null;
  targetProteinG: number | null;
  targetCarbsG: number | null;
  targetFatG: number | null;
};

// --- Fetch functions ---

export async function fetchNutritionDataForPeriod(
  clientId: string,
  periodStart: string,
  periodEnd: string
): Promise<{
  plans: NutritionPlanWithTargets[];
  nutritionLogs: NutritionLogRow[];
}> {
  // Uses supabaseAdmin: read-only client-scoped query in server context (RLS exception 2/3)
  const [plansResult, logsResult] = await Promise.all([
    // Nutrition plans overlapping the period
    supabaseAdmin
      .from("nutrition_plans")
      .select(`
        id, effective_from, effective_until,
        nutrition_plan_daily_targets (
          day_of_week, calories, protein_g, carb_g, fat_g
        )
      `)
      .eq("client_id", clientId)
      .lte("effective_from", periodEnd)
      .or(`effective_until.gte.${periodStart},effective_until.is.null`)
      .order("effective_from", { ascending: false }),

    // Nutrition logs in the period (includes stored targets with activity burn)
    supabaseAdmin
      .from("nutrition_logs")
      .select("date, calories_consumed, protein_g, carbs_g, fat_g, target_calories, target_protein_g, target_carbs_g, target_fat_g")
      .eq("client_id", clientId)
      .gte("date", periodStart)
      .lte("date", periodEnd) as unknown as Promise<{
        data: Array<{ date: string; calories_consumed: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; target_calories: number | null; target_protein_g: number | null; target_carbs_g: number | null; target_fat_g: number | null }> | null;
        error: { message: string } | null;
      }>,
  ]);

  if (plansResult.error) throw new Error(`Failed to fetch nutrition plans: ${plansResult.error.message}`);
  if (logsResult.error) throw new Error(`Failed to fetch nutrition logs: ${logsResult.error.message}`);

  const plans: NutritionPlanWithTargets[] = (plansResult.data || []).map((p: Record<string, unknown>) => ({
    id: p.id as string,
    effectiveFrom: p.effective_from as string,
    effectiveUntil: (p.effective_until as string) || null,
    dailyTargets: (
      (p.nutrition_plan_daily_targets as Array<Record<string, unknown>>) || []
    ).map((t) => ({
      dayOfWeek: t.day_of_week as string,
      calories: t.calories as number,
      proteinG: t.protein_g as number,
      carbG: t.carb_g as number,
      fatG: t.fat_g as number,
    })),
  }));

  const nutritionLogs: NutritionLogRow[] = (logsResult.data || []).map((l) => ({
    date: l.date,
    caloriesConsumed: l.calories_consumed,
    proteinG: l.protein_g,
    carbsG: l.carbs_g,
    fatG: l.fat_g,
    targetCalories: l.target_calories,
    targetProteinG: l.target_protein_g,
    targetCarbsG: l.target_carbs_g,
    targetFatG: l.target_fat_g,
  }));

  return { plans, nutritionLogs };
}
