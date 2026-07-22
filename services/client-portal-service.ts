import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { Client, DietType, UnitPreference } from "@/types/check-in";
import type { Database } from "@/types/database";
import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";
import { buildDailyTargetsFromPlan } from "@/utils/build-daily-targets";
import { mapClientRow } from "@/lib/mappers";
import { getActiveTrainingPlan } from "./training-service";
import { getEventsForDateRange } from "./training-event-service";
import { getNutritionEventsForDateRange } from "./nutrition-event-service";
import { getTrainingWeekStart, getTrainingWeekEnd } from "@/lib/date-helpers";
import { getClientTodayString } from "./today-service";

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

// Explicit client-facing allowlist for the client's own profile. Every column a
// client may see about themselves is named here; coach-private columns (notes)
// are deliberately excluded so a client-facing read can never leak them, and a
// future coach-only column is excluded by default rather than shipped.
const CLIENT_SELF_COLUMNS =
  "id, coach_id, name, email, avatar_url, active, created_at, updated_at, " +
  "height, height_unit, gender, date_of_birth, goal_weight, goal_body_fat_percentage, " +
  "weight_unit, current_weight, current_body_fat_percentage, bmr, tdee, " +
  "check_in_frequency, check_in_frequency_days, expected_check_in_day, " +
  "last_reminder_sent_at, reminder_preferences, total_check_ins_expected, " +
  "total_check_ins_completed, check_in_adherence_rate, current_streak, longest_streak, " +
  "unit_preference, include_activity_burn, surplus_as_carbs, starting_weight, " +
  "starting_body_fat_percentage, bmr_manual_override, tdee_manual_override, " +
  "welcome_message, onboarding_status, walkthrough_completed_at, start_date, timezone";

// Get client record for the authenticated user
export async function getClientForCurrentUser(): Promise<Client | null> {
  const supabase = await createPortalClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } = await supabase
    .from("clients")
    .select(CLIENT_SELF_COLUMNS)
    .eq("user_id", user.id)
    .eq("active", true)
    .single();

  if (error || !data) return null;

  // `notes` is not selected, so mapClientRow resolves it to undefined.
  return mapClientRow(data as unknown as Database["public"]["Tables"]["clients"]["Row"]);
}

// Get nutrition targets for a client with daily breakdown
export async function getClientNutritionTargets(
  clientId: string
): Promise<NutritionTargets | null> {
  const supabase = await createPortalClient();

  // Read include_activity_burn, unit_preference + surplus_as_carbs from clients
  // (display prefs stay on clients). surplus_as_carbs decides how a training-day
  // surplus splits — the program card must match the coach calendar.
  const { data: clientData, error: clientError } = await supabase
    .from("clients")
    .select("include_activity_burn, unit_preference, surplus_as_carbs")
    .eq("id", clientId)
    .single();

  if (clientError || !clientData) return null;

  const includeActivityBurn = clientData.include_activity_burn ?? true;
  const surplusAsCarbs = clientData.surplus_as_carbs ?? false;

  // Client-local today: the live-week anchor below. At 00:30 local just after
  // a UTC week boundary, server-UTC today would show last week's targets.
  const today = await getClientTodayString(clientId);

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
  // enrichment, plus the week's dense nutrition events so per-day coach edits
  // (is_modified) surface on the program card. Anchored to client-local today.
  const weekStart = getTrainingWeekStart(today);
  const weekEnd = getTrainingWeekEnd(today);

  const [trainingPlan, trainingEvents, nutritionEvents] = await Promise.all([
    getActiveTrainingPlan(clientId),
    getEventsForDateRange(clientId, weekStart, weekEnd),
    getNutritionEventsForDateRange(clientId, weekStart, weekEnd),
  ]);
  const dietType = (plan.diet_type as DietType) || "balanced";

  const dailyTargets = buildDailyTargetsFromPlan(
    plan,
    dailyTargetRows,
    trainingPlan,
    includeActivityBurn,
    dietType,
    surplusAsCarbs,
    trainingEvents,
    nutritionEvents
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
