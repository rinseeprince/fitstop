/**
 * Schedule Data Service
 * Bulk queries that feed the training schedule generator and nutrition period summary.
 * Used by both the check-in snapshot service and the history APIs.
 */

import { supabaseAdmin } from "./supabase-admin";

// --- Training data types (raw DB rows) ---

export type TrainingPlanWithSessions = {
  id: string;
  name: string;
  effectiveFrom: string;          // YYYY-MM-DD
  effectiveUntil: string | null;  // YYYY-MM-DD or null (current plan)
  sessions: Array<{
    id: string;
    name: string;
    dayOfWeek: string | null;
    focus: string | null;
    estimatedCalories: number | null;
  }>;
};

export type SessionLogRow = {
  id: string;
  clientId: string;
  trainingSessionId: string | null;
  completionQuality: "full" | "partial" | "skipped" | null;
  completedAt: string;            // YYYY-MM-DD
  notes: string | null;
};

export type TrainingLogRow = {
  date: string;                   // YYYY-MM-DD
  trainingSessionId: string | null;
  trainingData: {
    trainingSessionId?: string;
    trainingSessionName?: string;
    isAlternativeSession?: boolean;
  } | null;
};

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

export async function fetchTrainingDataForPeriod(
  clientId: string,
  periodStart: string,
  periodEnd: string
): Promise<{
  plans: TrainingPlanWithSessions[];
  sessionLogs: SessionLogRow[];
  trainingLogs: TrainingLogRow[];
}> {
  // Uses supabaseAdmin: read-only client-scoped query in server context (RLS exception 2/3)
  const [plansResult, sessionLogsResult, trainingLogsResult] = await Promise.all([
    // 1. Training plans overlapping the period
    supabaseAdmin
      .from("training_plans")
      .select(`
        id, name, effective_from, effective_until,
        training_sessions!inner (
          id, name, day_of_week, focus, estimated_calories
        )
      `)
      .eq("client_id", clientId)
      .is("deleted_at", null)
      .lte("effective_from", periodEnd)
      .or(`effective_until.gte.${periodStart},effective_until.is.null`)
      .order("effective_from", { ascending: false }),

    // 2. Session logs in the period
    supabaseAdmin
      .from("session_logs")
      .select("id, client_id, training_session_id, completion_quality, completed_at, notes")
      .eq("client_id", clientId)
      .gte("completed_at", periodStart)
      .lte("completed_at", periodEnd),

    // 3. Training logs for isAlternativeSession detection
    supabaseAdmin
      .from("daily_logs_full")
      .select("date, training_session_id, training_data")
      .eq("client_id", clientId)
      .eq("trained", true)
      .gte("date", periodStart)
      .lte("date", periodEnd) as unknown as Promise<{
        data: Array<{ date: string; training_session_id: string | null; training_data: unknown }> | null;
        error: { message: string } | null;
      }>,
  ]);

  if (plansResult.error) throw new Error(`Failed to fetch training plans: ${plansResult.error.message}`);
  if (sessionLogsResult.error) throw new Error(`Failed to fetch session logs: ${sessionLogsResult.error.message}`);
  if (trainingLogsResult.error) throw new Error(`Failed to fetch training logs: ${trainingLogsResult.error.message}`);

  const plans: TrainingPlanWithSessions[] = (plansResult.data || []).map((p: Record<string, unknown>) => ({
    id: p.id as string,
    name: p.name as string,
    effectiveFrom: p.effective_from as string,
    effectiveUntil: (p.effective_until as string) || null,
    sessions: (
      (p.training_sessions as Array<Record<string, unknown>>) || []
    )
      .filter((s) => s.is_active !== false)
      .map((s) => ({
        id: s.id as string,
        name: s.name as string,
        dayOfWeek: (s.day_of_week as string) || null,
        focus: (s.focus as string) || null,
        estimatedCalories: (s.estimated_calories as number) ?? null,
      })),
  }));

  const sessionLogs: SessionLogRow[] = (sessionLogsResult.data || []).map((s) => ({
    id: s.id,
    clientId: s.client_id,
    trainingSessionId: s.training_session_id,
    completionQuality: s.completion_quality as SessionLogRow["completionQuality"],
    completedAt: s.completed_at,
    notes: s.notes,
  }));

  const trainingLogs: TrainingLogRow[] = (trainingLogsResult.data || []).map((t) => ({
    date: t.date,
    trainingSessionId: t.training_session_id,
    trainingData: t.training_data as TrainingLogRow["trainingData"],
  }));

  return { plans, sessionLogs, trainingLogs };
}

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
