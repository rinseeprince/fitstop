import { getClientById } from "@/services/client-service";
import { generateNutritionPlan, calculateTDEE } from "@/services/nutrition-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import {
  resolveNutritionCalcInputs,
  type NutritionCalcInputs,
} from "@/services/nutrition-calc-inputs";
import {
  archiveNutritionPlan,
  createNutritionPlan,
  getActiveNutritionPlanId,
} from "@/services/nutrition-plan-service";
import { CUSTOM_MACRO_CALORIE_TOLERANCE } from "@/lib/constants";
import type { GenerateNutritionPlanRequest } from "@/types/check-in";
import {
  deleteFutureNutritionEventsForPlan,
  regenerateFutureNutritionEvents,
} from "@/services/nutrition-event-service";
import { captureApiError } from "@/lib/error-handler";
import { getClientTodayString } from "@/services/today-service";
import { addDaysToDateString } from "@/lib/date-helpers";

/** The resolver's success arm — both plan handlers require complete inputs. */
type ReadyCalcInputs = Extract<NutritionCalcInputs, { status: "ready" }>;

export class NutritionPlanError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = "NutritionPlanError";
  }
}

/**
 * The events ARE the product of a regenerate — a failed rewrite must not
 * return success, or the coach sees a green toast over a stale/gapped
 * calendar. The plan row has already committed by this point, so the message
 * says so; a retry re-POST is idempotent (upsert on client_id,date; coach
 * edits protected by is_modified) and repairs any partial state.
 */
async function regenerateEventsOrThrow(
  clientId: string,
  planId: string,
  fromDate: string
): Promise<void> {
  try {
    await regenerateFutureNutritionEvents(clientId, planId, fromDate);
  } catch (err) {
    captureApiError(err, { action: "generate-nutrition-events", planId });
    throw new NutritionPlanError(
      "Plan targets were saved, but calendar events failed to update. Regenerate the plan to retry.",
      500
    );
  }
}

export interface NutritionPlanResult {
  success: true;
  plan: Record<string, unknown>;
}

/**
 * Delete (archive) the client's durable nutrition plan and clear its upcoming
 * scheduled events so no orphaned prescription lingers on the calendar. Today
 * and past days are untouched; coach-edited (is_modified) FUTURE days go too,
 * deliberately — a deleted plan leaves no forward prescription.
 *
 * Events are cleared BEFORE the status flip so a mid-flight failure is
 * retryable: with the plan still active, a re-DELETE resolves it again and
 * repeats the (idempotent) event delete. Throws NutritionPlanError for
 * ownership / not-found failures.
 */
export async function orchestrateNutritionPlanDeletion(
  clientId: string,
  coachId: string
): Promise<{ planId: string }> {
  const client = await getClientById(clientId);

  if (!client) {
    throw new NutritionPlanError("Client not found", 404);
  }
  if (client.coachId !== coachId) {
    throw new NutritionPlanError("Forbidden: You don't have access to this client", 403);
  }

  const planId = await getActiveNutritionPlanId(clientId);
  if (!planId) {
    throw new NutritionPlanError("No active nutrition plan to delete", 404);
  }

  // Client-local today anchors the cutoff on the client's calendar — never let
  // the event helper fall back to its UTC default. Delete strictly AFTER
  // today: nutrition events never leave 'scheduled' status, so a today the
  // client already part-logged would otherwise be deleted and the per-card
  // nutrition writer would 422 mid-day (no event, no active plan). The kept
  // event carries its own plan stamp, and the dialog's "Today and past days
  // are kept" stays literally true.
  const clientToday = await getClientTodayString(clientId);
  const deleteFrom = addDaysToDateString(clientToday, 1);

  await deleteFutureNutritionEventsForPlan(planId, deleteFrom);
  await archiveNutritionPlan(planId);

  return { planId };
}

/**
 * Orchestrate creation of a nutrition plan (custom-macro or calculated).
 * Throws NutritionPlanError for validation / business-logic failures.
 */
export async function orchestrateNutritionPlanCreation(
  clientId: string,
  coachId: string,
  body: GenerateNutritionPlanRequest,
  validatedData: { coachNotes?: string }
): Promise<NutritionPlanResult> {
  const client = await getClientById(clientId);

  if (!client) {
    throw new NutritionPlanError("Client not found", 404);
  }
  if (client.coachId !== coachId) {
    throw new NutritionPlanError("Forbidden: You don't have access to this client", 403);
  }

  // Client-local today (coach-tz fallback): both the past-date validation and
  // the goal resolver must agree with the RPC's active-vs-planned decision, or
  // a coach near local midnight gets a spurious "past date" rejection.
  const clientToday = await getClientTodayString(clientId);

  // Validate effectiveFrom date
  if (body.effectiveFrom) {
    if (body.effectiveFrom < clientToday) {
      throw new NutritionPlanError("Effective date cannot be in the past", 400);
    }
  }

  // One resolver, shared with the coach GET, so the numbers the builder
  // previewed are the numbers this save computes from. `clientToday` is handed
  // in rather than re-resolved: the past-date check above already needed it.
  const calcInputs = await resolveNutritionCalcInputs(clientId, client, {
    today: clientToday,
  });

  // The resolver COMPUTES validity; the write path is where it becomes an
  // error. (A read path renders the same messages instead — a coach whose
  // client has no BMR yet must still be able to open the nutrition tab.)
  if (calcInputs.status === "incomplete") {
    throw new NutritionPlanError("Client missing required data for nutrition calculation", 400);
  }

  // Handle custom macros
  if (body.customMacrosEnabled) {
    return handleCustomMacros(clientId, coachId, body, calcInputs, validatedData);
  }

  // Generate calculated nutrition plan
  return handleCalculatedPlan(clientId, coachId, body, client, calcInputs, validatedData);
}

async function handleCustomMacros(
  clientId: string,
  coachId: string,
  body: GenerateNutritionPlanRequest,
  calcInputs: ReadyCalcInputs,
  validatedData: { coachNotes?: string }
): Promise<NutritionPlanResult> {
  const { currentWeightKg, bmr, tdee: tdeeValue, today: clientToday } = calcInputs;

  if (!body.customProteinG || !body.customCarbG || !body.customFatG || !body.customCalories) {
    throw new NutritionPlanError("Custom macros enabled but values not provided", 400);
  }

  const calculatedCalories =
    body.customProteinG * 4 + body.customCarbG * 4 + body.customFatG * 9;
  const difference = Math.abs(body.customCalories - calculatedCalories);

  if (difference > CUSTOM_MACRO_CALORIE_TOLERANCE) {
    throw new NutritionPlanError(
      `Custom calories must be within ±50 calories of macro totals (calculated: ${calculatedCalories} cal)`,
      400
    );
  }

  const tdee = bmr
    ? calculateTDEE(bmr, body.workActivityLevel)
    : tdeeValue;

  const newPlanId = await createNutritionPlan({
    clientId,
    coachId,
    workActivityLevel: body.workActivityLevel,
    trainingVolumeHours: body.trainingVolumeHours || "2-3",
    proteinTargetGPerKg: body.proteinTargetGPerKg,
    dietType: body.dietType,
    goalWeightKg: calcInputs.goalWeightKg ?? null,
    goalDeadline: calcInputs.goalDeadline ?? null,
    baselineCalories: body.customCalories,
    proteinTargetG: body.customProteinG,
    carbTargetG: body.customCarbG,
    fatTargetG: body.customFatG,
    baseWeightKg: currentWeightKg,
    bmr,
    tdee: tdee ?? null,
    customMacrosEnabled: true,
    customCalories: body.customCalories,
    customProteinG: body.customProteinG,
    customCarbG: body.customCarbG,
    customFatG: body.customFatG,
    regenerationReason: "custom_macros",
    trainingPlan: null, // vestigial param (createNutritionPlan ignores it)
    coachNotes: validatedData.coachNotes,
    effectiveFrom: body.effectiveFrom,
    // A fresh custom-macro plan establishes a new baseline at the current
    // weight -> re-stamp the banner snapshot.
    recalcSnapshots: true,
  });

  if (!newPlanId) {
    throw new NutritionPlanError("Failed to create nutrition plan", 500);
  }

  // In-place durable plan: the RPC upserts the single active plan (stable id),
  // so we regenerate its future events from one client-local anchor. No
  // separate old-plan cleanup — there is no old plan to delete.
  await regenerateEventsOrThrow(clientId, newPlanId, body.effectiveFrom ?? clientToday);

  return {
    success: true,
    plan: {
      calorieTarget: body.customCalories,
      proteinTargetG: body.customProteinG,
      carbTargetG: body.customCarbG,
      fatTargetG: body.customFatG,
      adjustedTdee: tdee ?? tdeeValue!,
      weeklyWeightChangeKg: 0,
      warnings: [],
    },
  };
}

async function handleCalculatedPlan(
  clientId: string,
  coachId: string,
  body: GenerateNutritionPlanRequest,
  _client: NonNullable<Awaited<ReturnType<typeof getClientById>>>,
  calcInputs: ReadyCalcInputs,
  validatedData: { coachNotes?: string }
): Promise<NutritionPlanResult> {
  const { currentWeightKg, bmr, today: clientToday } = calcInputs;

  // Only to distinguish an "initial" plan from a "regenerated" one.
  const { data: existingPlan } = await supabaseAdmin
    .from("nutrition_plans")
    .select("id")
    .eq("client_id", clientId)
    .eq("status", "active")
    .maybeSingle();

  // THE contract of this rework: the browser previewed the plan by calling this
  // exact pure function over these exact inputs, so what the coach saw is what
  // lands. There is deliberately no second code path here — the old
  // preserve-calories branch skipped the calculator entirely and reused the
  // stored baseline, which meant the numbers on screen were not the numbers
  // saved. "Edit manually" covers that intent honestly: the coach types the
  // number they want and it is stored as the target.
  const plan = generateNutritionPlan({
    ...calcInputs,
    workActivityLevel: body.workActivityLevel,
    trainingVolumeHours: body.trainingVolumeHours,
    trainingPlan: null, // vestigial param (generateNutritionPlan ignores it)
    proteinTargetGPerKg: body.proteinTargetGPerKg,
    dietType: body.dietType,
  });
  const regenerationReason = existingPlan ? "regenerated" : "initial";

  const newPlanId = await createNutritionPlan({
    clientId,
    coachId,
    workActivityLevel: body.workActivityLevel,
    trainingVolumeHours: body.trainingVolumeHours || "2-3",
    proteinTargetGPerKg: body.proteinTargetGPerKg,
    dietType: body.dietType,
    goalWeightKg: calcInputs.goalWeightKg ?? null,
    goalDeadline: calcInputs.goalDeadline ?? null,
    baselineCalories: plan.baselineCalories,
    proteinTargetG: plan.proteinTargetG,
    carbTargetG: plan.carbTargetG,
    fatTargetG: plan.fatTargetG,
    baseWeightKg: currentWeightKg,
    bmr,
    tdee: plan.tdee,
    customMacrosEnabled: false,
    customCalories: null,
    customProteinG: null,
    customCarbG: null,
    customFatG: null,
    regenerationReason,
    trainingPlan: null, // vestigial param (createNutritionPlan ignores it)
    coachNotes: validatedData.coachNotes,
    effectiveFrom: body.effectiveFrom,
    // Every surviving path through this function is a genuine recompute, so the
    // banner snapshot always re-stamps. This was `!body.preserveCalories`, and
    // it read `false` on exactly one path — the preserve-calories regen, which
    // reused the stored baseline instead of recalculating and therefore had to
    // leave base_weight_kg alone or the weight-drift banner would wrongly
    // silence. That path is gone. Set this to `true` rather than deleting the
    // key: createNutritionPlan reads `params.recalcSnapshots ?? false`, so an
    // omitted key means the snapshot silently STOPS re-stamping — the exact
    // inverse, arriving by omission, with the drift banner just never firing.
    recalcSnapshots: true,
  });

  if (!newPlanId) {
    throw new NutritionPlanError("Failed to create nutrition plan", 500);
  }

  // In-place durable plan: the RPC upserts the single active plan (stable id),
  // so we regenerate its future events from one client-local anchor. No
  // separate old-plan cleanup — there is no old plan to delete.
  await regenerateEventsOrThrow(clientId, newPlanId, body.effectiveFrom ?? clientToday);

  return {
    success: true,
    plan: {
      baselineCalories: plan.baselineCalories,
      tdee: plan.tdee,
      calorieTarget: plan.calorieTarget,
      proteinTargetG: plan.proteinTargetG,
      carbTargetG: plan.carbTargetG,
      fatTargetG: plan.fatTargetG,
      adjustedTdee: plan.adjustedTdee,
      weeklyWeightChangeKg: plan.weeklyWeightChangeKg,
      requiredDailyDeficit: plan.requiredDailyDeficit,
      warnings: plan.warnings,
    },
  };
}
