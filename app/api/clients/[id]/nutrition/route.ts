import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import {
  getTrainingPlanSummaryForDate,
  getNextFutureTrainingPlan,
} from "@/services/training-service";
import { getClientTodayString } from "@/services/today-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import {
  nutritionPlanSchema,
  nutritionSettingsPatchSchema,
} from "@/lib/validations/nutrition";
import type { ClientUpdate } from "@/lib/database-helpers";
import type { GenerateNutritionPlanRequest } from "@/types/check-in";
import {
  orchestrateNutritionPlanCreation,
  orchestrateNutritionPlanDeletion,
  NutritionPlanError,
} from "@/services/nutrition-plan-orchestrator";
import { getCurrentGoals } from "@/services/client-goals-service";
import { resolveNutritionCalcInputs } from "@/services/nutrition-calc-inputs";
import { captureApiError } from "@/lib/error-handler";
import { resolveEffectiveGoal } from "@/lib/goals/resolve-effective-goal";
import { detectGoalDrift } from "@/lib/goals/detect-goal-drift";
import { recordAuditEvent } from "@/services/audit-log-service";
import { AUDIT_ACTIONS } from "@/lib/constants";

/**
 * GET: Return the active nutrition plan's baseline targets + calculator
 * settings for the coach view. Per-day targets are NOT here — they live on
 * nutrition_events and the calendar reads them directly.
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

    // CLIENT-local, because it mirrors GET /training, whose plan resolution is
    // client-local — the two ladders differ (client tz -> coach tz -> UTC vs
    // coach tz -> UTC) and would disagree across a date boundary.
    const clientToday = await getClientTodayString(clientId);

    // hasTrainingPlan replaces a whole 210 kB GET /training round trip that the
    // nutrition tab fired purely to ask "does a plan exist?". It reproduces that
    // route's `plan: activePlan ?? nextFullPlan` predicate using the summary
    // lookups, so no sessions or exercises are hydrated on either side. It rides
    // alongside the active-plan read because neither depends on the other, and it
    // must be resolved BEFORE the no-plan early return — the tab's training
    // section is independent of whether a nutrition plan exists.
    // `getCurrentGoals` is hoisted into this batch from below: the drift check
    // needs it AND the calc-input resolver needs it, so fetching it once here
    // costs one query instead of two and removes a sequential hop.
    const [planResult, activePlan, nextPlan, currentGoals] = await Promise.all([
      supabaseAdmin
        .from("nutrition_plans")
        .select("*")
        .eq("client_id", clientId)
        .eq("status", "active")
        .order("effective_from", { ascending: false })
        .limit(1)
        .maybeSingle(),
      getTrainingPlanSummaryForDate(clientId, clientToday),
      getNextFutureTrainingPlan(clientId, clientToday),
      getCurrentGoals(clientId),
    ]);
    const plan = planResult.data;
    const hasTrainingPlan = Boolean(activePlan ?? nextPlan);

    // `nutrition_plans.name` is never written, so the Plans-tab hero titles
    // itself with the program the client is on — the same "which block is this"
    // question a phase name will answer once phases ship. Same predicate as
    // hasTrainingPlan: the running program, else the queued one.
    const trainingPlanName = activePlan?.name ?? nextPlan?.name ?? null;

    // The exact inputs the plan POST will calculate from, sent to the browser so
    // the builder can preview a plan live as the coach moves a picker — same
    // resolver, same pure calculator, so preview and save cannot disagree.
    //
    // Resolved BEFORE the no-plan early return and returned on BOTH branches:
    // a coach creating their FIRST plan is exactly who needs the preview, and
    // computing it above a three-key literal that ignores it would make it dead
    // precisely then.
    //
    // A failure here degrades the preview to null rather than failing the read.
    // This route's catch has no NutritionPlanError branch, so an uncaught throw
    // becomes a blanket 500 — and the client treats a non-OK response as "no
    // plan", so a body-metrics hiccup would blank a working nutrition tab.
    // The POST does its own strict resolution, so Generate still behaves.
    const calcInputs = await resolveNutritionCalcInputs(clientId, client, {
      today: clientToday,
      currentGoals,
    }).catch((err) => {
      captureApiError(err, { action: "nutrition-calc-inputs", clientId });
      return null;
    });

    if (!plan) {
      return NextResponse.json({
        success: true,
        hasPlan: false,
        hasTrainingPlan,
        trainingPlanName,
        calcInputs,
      });
    }

    // No weekday-template targets are built here any more. This route used to
    // read nutrition_plan_daily_targets + a week of training_events and collapse
    // them into a 7-row `dailyTargets` projection, purely to feed the Plans-tab
    // stat band. That band is gone — the Plans hero now names the program and
    // the calendar owns per-day targets — so the two queries had no reader.
    // Per-day truth lives on nutrition_events (events-as-SOT); the client
    // portal builds its own date-accurate targets in client-portal-service.

    // Goal-drift flag (Session 7.8): does the goal that drives the client NOW
    // (effective-goal resolver) differ from the snapshot this active plan was
    // built against? Surfaced as "Goal changed — regenerate", distinct from the
    // weight-delta banner (which compares current weight vs the plan base weight).
    // Anchored on the CLIENT's today, matching the write path. Previously this
    // used the coach's, so one request carried two "todays". It is a provable
    // no-op rather than a behaviour change: resolveEffectiveGoal reads `today`
    // at exactly one place — the startDate fallback — and detectGoalDrift
    // consumes only goalWeightKg and deadline, neither of which touches it.
    const effectiveGoal = resolveEffectiveGoal({
      clientGoal: {
        goalWeight: currentGoals?.goalWeight ?? client.goalWeight ?? null,
        goalBodyFatPercentage:
          currentGoals?.goalBodyFatPercentage ?? client.goalBodyFatPercentage ?? null,
        deadline: currentGoals?.goalDeadline ?? client.goalDeadline ?? null,
        startDate: currentGoals?.goalStartDate ?? null,
      },
      today: clientToday,
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
      // The two remaining calculator settings, so the builder's pickers seed
      // from the ACTIVE PLAN instead of their hardcoded defaults. Without these
      // a coach opening a keto plan sees "Balanced" and a regenerate silently
      // rewrites the plan they never meant to change.
      workActivityLevel: plan.work_activity_level,
      proteinTargetGPerKg: Number(plan.protein_target_g_per_kg),
      includeActivityBurn,
      effectiveFrom: plan.effective_from,
      // Queued-not-running, resolved SERVER-side against the client's today the
      // way GET /training resolves its own `scheduledFor`. The browser must not
      // make this call: its local date can differ from the client's by a day.
      scheduledFor: plan.effective_from > clientToday ? plan.effective_from : null,
      goalChanged,
      hasTrainingPlan,
      trainingPlanName,
      calcInputs,
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
