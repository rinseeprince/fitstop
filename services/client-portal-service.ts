import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { Client, DietType, UnitPreference } from "@/types/check-in";
import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";
import { buildDailyTargetsFromPlan } from "@/utils/build-daily-targets";
import { mapClientRow } from "@/lib/mappers";
import { getActiveTrainingPlan } from "./training-service";
import { getEventsForDateRange } from "./training-event-service";
import { getTrainingWeekStart, getTrainingWeekEnd } from "@/lib/date-helpers";
import { getClientTodayString } from "./today-service";
import { promoteNutritionPlanIfReady } from "./nutrition-plan-service";

// Session-scoped Supabase client for client-portal reads that rely on RLS.
// Re-exported under the old name so existing callers don't churn; the body
// lives in lib/supabase-server.ts (canonical factory).
export const createPortalClient = createServerSupabaseClient;

// Nutrition targets type
export type NutritionTargets = {
  planId?: string;
  calorieTarget?: number;
  proteinTargetG?: number;
  carbTargetG?: number;
  fatTargetG?: number;
  customMacrosEnabled?: boolean;
  customCalories?: number;
  customProteinG?: number;
  customCarbG?: number;
  customFatG?: number;
  dietType?: DietType;
  unitPreference?: UnitPreference;
  baselineCalories?: number;
  includeActivityBurn: boolean;
  customDayDistribution?: boolean;
  dailyTargets?: DailyNutritionTargets[];
};

// Get client record for the authenticated user
export async function getClientForCurrentUser(): Promise<Client | null> {
  const supabase = await createPortalClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("user_id", user.id)
    .eq("active", true)
    .single();

  if (error || !data) return null;

  return mapClientRow(data);
}

// Get nutrition targets for a client with daily breakdown
export async function getClientNutritionTargets(
  clientId: string
): Promise<NutritionTargets | null> {
  const supabase = await createPortalClient();

  // Read include_activity_burn and unit_preference from clients (display prefs stay on clients)
  const { data: clientData, error: clientError } = await supabase
    .from("clients")
    .select("include_activity_burn, unit_preference")
    .eq("id", clientId)
    .single();

  if (clientError || !clientData) return null;

  const includeActivityBurn = clientData.include_activity_burn ?? true;

  // Client-local today: resolved once, shared by the promotion check and the
  // live-week anchor below. At 00:30 local just after a UTC week boundary,
  // server-UTC today would show last week's targets.
  const today = await getClientTodayString(clientId);

  // Promote planned plan if its effective date has arrived
  // supabaseAdmin: system-level write for plan lifecycle (promotion uses admin internally)
  await promoteNutritionPlanIfReady(clientId, today);

  // Read active nutrition plan from new tables
  const { data: plan, error: planError } = await supabase
    .from("nutrition_plans")
    .select("*")
    .eq("client_id", clientId)
    .eq("status", "active")
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (planError || !plan) return null;

  // Fetch daily targets for this plan
  const { data: dailyTargetRows, error: dtError } = await supabase
    .from("nutrition_plan_daily_targets")
    .select("*")
    .eq("nutrition_plan_id", plan.id);

  if (dtError) return null;

  // Fetch training plan + current week's training events for live calorie
  // enrichment, anchored to the client-local today resolved above.
  const weekStart = getTrainingWeekStart(today);
  const weekEnd = getTrainingWeekEnd(today);

  const [trainingPlan, trainingEvents] = await Promise.all([
    getActiveTrainingPlan(clientId),
    getEventsForDateRange(clientId, weekStart, weekEnd),
  ]);
  const dietType = (plan.diet_type as DietType) || "balanced";

  const dailyTargets = buildDailyTargetsFromPlan(
    plan,
    dailyTargetRows,
    trainingPlan,
    includeActivityBurn,
    dietType,
    trainingEvents
  );

  return {
    planId: plan.id,
    calorieTarget: plan.custom_macros_enabled && plan.custom_calories ? plan.custom_calories : plan.baseline_calories,
    proteinTargetG: plan.protein_target_g,
    carbTargetG: plan.carb_target_g,
    fatTargetG: plan.fat_target_g,
    customMacrosEnabled: plan.custom_macros_enabled,
    customCalories: plan.custom_calories,
    customProteinG: plan.custom_protein_g,
    customCarbG: plan.custom_carb_g,
    customFatG: plan.custom_fat_g,
    dietType: plan.diet_type,
    unitPreference: clientData.unit_preference,
    baselineCalories: plan.baseline_calories,
    includeActivityBurn,
    customDayDistribution: false, // No longer needed — daily targets rows ARE the distribution
    dailyTargets,
  };
}
