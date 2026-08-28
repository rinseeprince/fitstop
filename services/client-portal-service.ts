import { createServerSupabaseClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "./supabase-admin";
import { coversDate } from "./training-plan-window";
import type { Client, DietType, UnitPreference } from "@/types/check-in";
import type { Database } from "@/types/database";
import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";
import { buildDailyTargetsFromPlan } from "@/utils/build-daily-targets";
import { mapClientRow } from "@/lib/mappers";
import { getEventsForDateRange } from "./training-event-service";
import { getNutritionEventsForDateRange } from "./nutrition-event-service";
import { getTrainingWeekStart, getTrainingWeekEnd } from "@/lib/date-helpers";
import { getClientWeekAnchor } from "./check-in-week-service";
import { getClientTodayString } from "./today-service";

// Session-scoped Supabase client, for the one read that genuinely needs the
// session: getClientForCurrentUser resolves the caller's own row from
// `auth.getUser()` with no clientId to scope by. Re-exported under the old name
// so existing callers don't churn; the body lives in lib/supabase-server.ts
// (canonical factory).
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
// SCOPE: this list governs THIS read, not every client-facing surface — the
// goal DEADLINE (absent here) reaches the client through GET /api/client/journey
// via client_goals/resolveEffectiveGoal (owner decision 2026-08-12, scoped to
// that endpoint only).
const CLIENT_SELF_COLUMNS =
  "id, coach_id, name, email, avatar_url, active, created_at, updated_at, " +
  "height, gender, date_of_birth, goal_weight, goal_body_fat_percentage, " +
  "current_weight, current_body_fat_percentage, bmr, tdee, " +
  "check_in_frequency, check_in_frequency_days, next_check_in_due, " +
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
  // Three independent client-scoped reads, run together.
  //
  // - display prefs (surplus_as_carbs decides how a training-day surplus
  //   splits — the program card must match the coach calendar);
  // - client-local today, because at 00:30 local just after a UTC week
  //   boundary server-UTC today would show last week's targets;
  // - the weekday their week ends on. This window used to be hard Mon-Sun for
  //   every client, so a client's own nutrition page described a different
  //   seven days from the week their coach sees for them.
  const [{ data: clientData, error: clientError }, today, { weekday: checkInDay }] =
    await Promise.all([
      supabaseAdmin
        .from("clients")
        .select("include_activity_burn, unit_preference, surplus_as_carbs")
        .eq("id", clientId)
        .single(),
      getClientTodayString(clientId),
      getClientWeekAnchor(clientId),
    ]);

  if (clientError || !clientData) return null;

  const includeActivityBurn = clientData.include_activity_burn ?? true;
  const surplusAsCarbs = clientData.surplus_as_carbs ?? false;

  // The version COVERING the client's today (migration 144): the portal's
  // program card shows what governs them NOW. The old newest-active read
  // handed a queued future version to a client still living on the current
  // one; coversDate resolves the same row the coach surfaces resolve.
  const { data: plan, error: planError } = await coversDate(
    supabaseAdmin
      .from("nutrition_plans")
      .select("*")
      .eq("client_id", clientId)
      .eq("status", "active"),
    today
  )
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (planError || !plan) return null;

  // Fetch daily targets for this plan
  const { data: dailyTargetRows, error: dtError } = await supabaseAdmin
    .from("nutrition_plan_daily_targets")
    .select("*")
    .eq("nutrition_plan_id", plan.id);

  if (dtError) return null;

  // Fetch the current week's training events for live calorie enrichment,
  // plus the week's dense nutrition events so per-day coach edits (is_modified)
  // surface on the program card. Anchored to client-local today.
  const weekStart = getTrainingWeekStart(today, checkInDay);
  const weekEnd = getTrainingWeekEnd(today, checkInDay);

  const [trainingEvents, nutritionEvents] = await Promise.all([
    getEventsForDateRange(clientId, weekStart, weekEnd),
    getNutritionEventsForDateRange(clientId, weekStart, weekEnd),
  ]);
  const dietType = (plan.diet_type as DietType) || "balanced";

  const dailyTargets = buildDailyTargetsFromPlan({
    plan,
    dailyTargetRows,
    includeActivityBurn,
    dietType,
    surplusAsCarbs,
    trainingEvents,
    nutritionEvents,
    // Dates the weekday grid so the template fallback is gated to the days
    // THIS version governs — both window ends (migration 144): a no-event day
    // before effective_from belongs to an earlier era, one after
    // effective_until to the next, and neither may render this version's
    // template as its target.
    weekWindow: {
      weekStart,
      effectiveFrom: plan.effective_from ?? null,
      effectiveUntil: plan.effective_until ?? null,
    },
  });

  return {
    planId: plan.id,
    calorieTarget: plan.custom_macros_enabled && plan.custom_calories ? plan.custom_calories : plan.baseline_calories,
    proteinTargetG: plan.protein_target_g,
    carbTargetG: plan.carb_target_g,
    fatTargetG: plan.fat_target_g,
    customMacrosEnabled: plan.custom_macros_enabled,
    // NutritionTargets models "absent" as undefined; the columns are nullable.
    customCalories: plan.custom_calories ?? undefined,
    customProteinG: plan.custom_protein_g ?? undefined,
    customCarbG: plan.custom_carb_g ?? undefined,
    customFatG: plan.custom_fat_g ?? undefined,
    dietType,
    unitPreference: (clientData.unit_preference as UnitPreference | null) ?? undefined,
    baselineCalories: plan.baseline_calories,
    includeActivityBurn,
    // RETIRED FIELD, kept on the wire only. The coach-side "Custom day
    // distribution" feature it named was deleted; nothing in this repo reads
    // this. It still ships because GET /api/client/nutrition-plan is the React
    // Native contract and we cannot verify from here that the app ignores it.
    // Drop it the next time that contract is revised deliberately.
    customDayDistribution: false,
    dailyTargets,
  };
}
