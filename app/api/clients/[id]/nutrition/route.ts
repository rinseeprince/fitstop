import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import {
  getTrainingPlanIdForDate,
  getNextFutureTrainingPlan,
} from "@/services/training-service";
import { getEventsForDateRange } from "@/services/training-event-service";
import { getTrainingWeekStart, getTrainingWeekEnd } from "@/lib/date-helpers";
import {
  getCoachTodayString,
  getClientTodayString,
} from "@/services/today-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import {
  nutritionPlanSchema,
  nutritionSettingsPatchSchema,
} from "@/lib/validations/nutrition";
import { buildDailyTargetsFromPlan } from "@/utils/build-daily-targets";
import type { ClientUpdate } from "@/lib/database-helpers";
import type { DietType, GenerateNutritionPlanRequest } from "@/types/check-in";
import {
  orchestrateNutritionPlanCreation,
  orchestrateNutritionPlanDeletion,
  NutritionPlanError,
} from "@/services/nutrition-plan-orchestrator";
import { getCurrentGoals } from "@/services/client-goals-service";
import { resolveEffectiveGoal } from "@/lib/goals/resolve-effective-goal";
import { detectGoalDrift } from "@/lib/goals/detect-goal-drift";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";

/**
 * GET: Return the active nutrition plan + daily targets for the coach view.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId } = await params;
    const client = await getClientById(clientId);

    if (!client) {
      return NextResponse.json({ success: false, error: "Client not found" }, { status: 404 });
    }
    if (client.coachId !== coachId) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const includeActivityBurn = client.includeActivityBurn ?? true;

    // Two different calendars, deliberately. The week window below is
    // COACH-local ("current week" in the coach's view); `hasTrainingPlan` must be
    // CLIENT-local because it mirrors GET /training, whose plan resolution is
    // client-local — the two ladders differ (client tz -> coach tz -> UTC vs
    // coach tz -> UTC) and would disagree across a date boundary.
    const [today, clientToday] = await Promise.all([
      getCoachTodayString(coachId),
      getClientTodayString(clientId),
    ]);

    // hasTrainingPlan replaces a whole 210 kB GET /training round trip that the
    // nutrition tab fired purely to ask "does a plan exist?". It reproduces that
    // route's `plan: activePlan ?? nextFullPlan` predicate using the id-only
    // lookups, so no sessions or exercises are hydrated on either side. It rides
    // alongside the active-plan read because neither depends on the other, and it
    // must be resolved BEFORE the no-plan early return — the tab's training
    // section is independent of whether a nutrition plan exists.
    const [planResult, activePlanId, nextPlan] = await Promise.all([
      supabaseAdmin
        .from("nutrition_plans")
        .select("*")
        .eq("client_id", clientId)
        .eq("status", "active")
        .order("effective_from", { ascending: false })
        .limit(1)
        .maybeSingle(),
      getTrainingPlanIdForDate(clientId, clientToday),
      getNextFutureTrainingPlan(clientId, clientToday),
    ]);
    const plan = planResult.data;
    const hasTrainingPlan = Boolean(activePlanId ?? nextPlan);

    if (!plan) {
      return NextResponse.json({ success: true, hasPlan: false, hasTrainingPlan });
    }

    const weekStart = getTrainingWeekStart(today);
    const weekEnd = getTrainingWeekEnd(today);

    // Daily targets need plan.id; the events read does not. One stage, not two.
    const [dailyTargetsResult, trainingEvents] = await Promise.all([
      supabaseAdmin
        .from("nutrition_plan_daily_targets")
        .select("*")
        .eq("nutrition_plan_id", plan.id),
      getEventsForDateRange(clientId, weekStart, weekEnd),
    ]);
    const dailyTargetRows = dailyTargetsResult.data;
    const dietType = (plan.diet_type as DietType) || "balanced";

    // Weekday-template targets (no nutritionEvents): feed the Plans-tab stat
    // band, honoring the surplus-split toggle so they match
    // the coach calendar.
    // trainingPlan is null on purpose, NOT an oversight. Every read of that
    // argument inside buildDailyTargetsFromPlan sits in the `else` of a
    // `trainingEvents ? … : …` guard, and getEventsForDateRange always returns an
    // array (`(data ?? []).map(…)`, throwing rather than returning null) — and an
    // empty array is truthy. So the plan branch is unreachable from this route,
    // and hydrating a whole multi-week program here only to discard it cost four
    // queries and three critical-path hops per request. The plan branch stays
    // live for the client-portal caller, so do NOT delete it from the util; if
    // this route ever stops passing trainingEvents, restore the plan fetch too.
    const dailyTargets = buildDailyTargetsFromPlan(
      plan,
      dailyTargetRows,
      null,
      includeActivityBurn,
      dietType,
      client.surplusAsCarbs ?? false,
      trainingEvents
    );

    // Goal-drift flag (Session 7.8): does the goal that drives the client NOW
    // (effective-goal resolver) differ from the snapshot this active plan was
    // built against? Surfaced as "Goal changed — regenerate", distinct from the
    // weight-delta banner (which compares current weight vs the plan base weight).
    const driftGoals = await getCurrentGoals(clientId);
    const effectiveGoal = resolveEffectiveGoal({
      weightUnit: client.weightUnit ?? "lbs",
      clientGoal: {
        goalWeight: driftGoals?.goalWeight ?? client.goalWeight ?? null,
        goalBodyFatPercentage:
          driftGoals?.goalBodyFatPercentage ?? client.goalBodyFatPercentage ?? null,
        deadline: driftGoals?.goalDeadline ?? client.goalDeadline ?? null,
        startDate: driftGoals?.goalStartDate ?? null,
      },
      today,
    });
    const goalChanged = detectGoalDrift(
      { goalWeightKg: plan.goal_weight_kg ?? null, deadline: plan.goal_deadline ?? null },
      effectiveGoal
    );

    return NextResponse.json({
      calorieTarget: plan.custom_macros_enabled && plan.custom_calories ? plan.custom_calories : plan.baseline_calories,
      proteinTargetG: plan.protein_target_g,
      carbTargetG: plan.carb_target_g,
      fatTargetG: plan.fat_target_g,
      baselineCalories: plan.baseline_calories,
      customMacrosEnabled: plan.custom_macros_enabled,
      customCalories: plan.custom_calories,
      customProteinG: plan.custom_protein_g,
      customCarbG: plan.custom_carb_g,
      customFatG: plan.custom_fat_g,
      dietType: plan.diet_type,
      includeActivityBurn,
      effectiveFrom: plan.effective_from,
      dailyTargets,
      goalChanged,
      hasTrainingPlan,
    });
  } catch (error) {
    console.error("Error fetching nutrition plan:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ success: false, error: "Failed to fetch nutrition plan" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId } = await params;

    const body: GenerateNutritionPlanRequest = await request.json();
    const validationResult = nutritionPlanSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json({ success: false, error: "Invalid input" }, { status: 400 });
    }

    const result = await orchestrateNutritionPlanCreation(
      clientId,
      coachId,
      body,
      { coachNotes: validationResult.data.coachNotes }
    );

    void recordAuditEvent({
      actorId: coachId,
      actorRole: "trainer",
      action: AUDIT_ACTIONS.NUTRITION_PLAN_CREATE,
      targetTable: "nutrition_plans",
      clientId,
      request,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof NutritionPlanError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.statusCode });
    }
    console.error("Error generating nutrition plan:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json(
      { success: false, error: "Failed to generate nutrition plan" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const coachId = await getAuthenticatedCoachId();

    if (!coachId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId } = await params;
    const client = await getClientById(clientId);

    if (!client) {
      return NextResponse.json({ success: false, error: "Client not found" }, { status: 404 });
    }

    if (client.coachId !== coachId) {
      return NextResponse.json(
        { success: false, error: "Forbidden: You don't have access to this client" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validationResult = nutritionSettingsPatchSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input" },
        { status: 400 }
      );
    }

    // Only include_activity_burn and unit_preference remain on clients table
    const updates: ClientUpdate = {};
    if (validationResult.data.unitPreference !== undefined) {
      updates.unit_preference = validationResult.data.unitPreference;
    }
    if (validationResult.data.includeActivityBurn !== undefined) {
      updates.include_activity_burn = validationResult.data.includeActivityBurn;
    }
    if (validationResult.data.surplusAsCarbs !== undefined) {
      updates.surplus_as_carbs = validationResult.data.surplusAsCarbs;
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await supabaseAdmin
        .from("clients")
        .update(updates)
        .eq("id", clientId)
        .eq("coach_id", coachId);

      if (error) throw new Error("Failed to update settings");
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error updating nutrition settings:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json(
      { success: false, error: "Failed to update nutrition settings" },
      { status: 500 }
    );
  }
}

/**
 * DELETE: Remove (archive) the client's nutrition plan and clear its upcoming
 * daily targets. Past and logged days are kept for history.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const coachId = await getAuthenticatedCoachId(request);
    if (!coachId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId } = await params;

    // Ownership is verified inside the orchestrator (404 / 403 via NutritionPlanError).
    const { planId } = await orchestrateNutritionPlanDeletion(clientId, coachId);

    void recordAuditEvent({
      actorId: coachId,
      actorRole: "trainer",
      action: AUDIT_ACTIONS.NUTRITION_PLAN_DELETE,
      targetTable: "nutrition_plans",
      targetId: planId,
      clientId,
      request,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    if (error instanceof NutritionPlanError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: error.statusCode }
      );
    }
    console.error("Error deleting nutrition plan:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json(
      { success: false, error: "Failed to delete nutrition plan" },
      { status: 500 }
    );
  }
}
