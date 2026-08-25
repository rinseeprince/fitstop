import { getClientById } from "@/services/client-service";
import { generateNutritionPlan } from "@/services/nutrition-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import {
  resolveNutritionCalcInputs,
  type NutritionCalcInputs,
} from "@/services/nutrition-calc-inputs";
import {
  createNutritionPlan,
  getNutritionPlanForDate,
} from "@/services/nutrition-plan-service";
import { CUSTOM_MACRO_CALORIE_TOLERANCE } from "@/lib/constants";
import type { GenerateNutritionPlanRequest } from "@/types/check-in";
import {
  deleteFutureNutritionEventsForClient,
  regenerateFutureNutritionEvents,
} from "@/services/nutrition-event-service";
import { recordPlanSaveNote } from "@/services/nutrition-plan-notes-service";
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
    await regenerateFutureNutritionEvents(clientId, planId, { kind: "from", from: fromDate });
  } catch (err) {
    captureApiError(err, { action: "generate-nutrition-events", planId });
    throw new NutritionPlanError(
      "Plan targets were saved, but calendar events failed to update. Regenerate the plan to retry.",
      500
    );
  }
}

interface NutritionPlanResult {
  success: true;
  plan: Record<string, unknown>;
}

/**
 * Record the coach's note about this change, in both of its homes.
 *
 * Called from BOTH plan handlers. They each own their own
 * createNutritionPlan -> regenerate -> return sequence and return directly out
 * of the dispatch, so there is no seam after them to hook — inlining it twice
 * is how one branch silently ends up without it.
 *
 * This USED to be `stampCoachNote`, which wrote one mutable column and sent any
 * failure to Sentry behind a 200. That silence is no longer acceptable: since
 * migration 147 the note is client-visible, and losing coach-authored content
 * the client was meant to read is not a background error (CONVENTIONS §2 item
 * 12). The write ordering that makes this retryable lives in the service.
 *
 * WHY A RETRY IS SAFE, and it is not obvious: this throws AFTER the plan row
 * has committed, so the coach re-saves and the whole save re-runs, RPC
 * included. That does not mint a second plan version because of migration 144's
 * branch (c) — an open version starting on/after the incoming date is ABSORBED,
 * updated in place, rather than closed-and-inserted, so a same-effective-date
 * re-save collapses into the existing row (144:60-63, body at :237-267). The
 * guarantee is scoped to the same effective date; a save on a LATER day takes
 * branch (b) and mints a version, which is correct behaviour rather than a
 * retry hazard.
 */
async function recordCoachNoteOrThrow(
  clientId: string,
  coachId: string,
  planId: string,
  effectiveOn: string,
  note: string | undefined
): Promise<void> {
  try {
    await recordPlanSaveNote({ clientId, coachId, planId, effectiveOn, body: note });
  } catch (err) {
    captureApiError(err, { action: "record-plan-save-note", clientId, planId });
    throw new NutritionPlanError(
      "Plan targets and calendar were saved, but your note was not. Save again to add it.",
      500
    );
  }
}

/**
 * Delete the client's nutrition plan CHAIN (migration 144): close the
 * covering version at their today, remove queued versions, and clear upcoming
 * scheduled events so no orphaned prescription lingers on the calendar. Today
 * and past days are untouched; coach-edited (is_modified) FUTURE days go too,
 * deliberately — a deleted plan leaves no forward prescription.
 *
 * Events are cleared FIRST so a mid-flight failure is retryable: with the
 * chain intact, a re-DELETE resolves it again and repeats the (idempotent)
 * steps. Throws NutritionPlanError for ownership / not-found failures.
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

  // The versioned chain (migration 144). Delete = close, never erase, for
  // governed days; hard-delete for never-effective queued versions (D2):
  //  - the COVERING version stays ACTIVE with effective_until = clientToday —
  //    its ended, successor-less window IS the record of the delete, and it
  //    keeps explaining today and the past in history reads;
  //  - QUEUED versions governed nothing, and any retained window would
  //    corrupt no-status-filter history attribution, so their rows go
  //    (daily targets CASCADE; event/log FKs are SET NULL).
  // Deletable = something reaches PAST today (an open or future-closed
  // covering window, or a queued version); a chain already ending at today
  // has nothing left to remove and 404s, which also makes a same-day second
  // delete a clean 404 rather than a silent success.
  const clientToday = await getClientTodayString(clientId);
  const covering = await getNutritionPlanForDate(clientId, clientToday);
  const coveringReachesPastToday =
    covering != null &&
    (covering.effective_until === null || covering.effective_until > clientToday);

  const { data: queuedRows, error: queuedError } = await supabaseAdmin
    .from("nutrition_plans")
    .select("id")
    .eq("client_id", clientId)
    .eq("status", "active")
    .gt("effective_from", clientToday);
  if (queuedError) {
    throw new NutritionPlanError(
      `Failed to resolve queued nutrition versions: ${queuedError.message}`,
      500
    );
  }
  const queuedIds = (queuedRows ?? []).map((row) => row.id);

  if (!coveringReachesPastToday && queuedIds.length === 0) {
    throw new NutritionPlanError("No active nutrition plan to delete", 404);
  }

  // Client-local today anchors the cutoff on the client's calendar — never a
  // UTC fallback. Delete strictly AFTER today: nutrition events never leave
  // 'scheduled' status, so a today the client already part-logged would
  // otherwise be deleted and the per-card nutrition writer would 422 mid-day.
  // The kept event carries its own plan stamp, and the dialog's "Today and
  // past days are kept" stays literally true. Client-scoped so events stamped
  // by queued versions' ids are swept too. Steps are ordered idempotently: a
  // mid-flight failure leaves a state a retry completes (events first — a
  // re-run deletes nothing; then queued rows; then the close).
  const deleteFrom = addDaysToDateString(clientToday, 1);
  await deleteFutureNutritionEventsForClient(clientId, deleteFrom);

  if (queuedIds.length > 0) {
    const { error: queuedDeleteError } = await supabaseAdmin
      .from("nutrition_plans")
      .delete()
      .in("id", queuedIds);
    if (queuedDeleteError) {
      throw new NutritionPlanError(
        `Failed to remove queued nutrition versions: ${queuedDeleteError.message}`,
        500
      );
    }
  }

  if (coveringReachesPastToday && covering) {
    const { error: closeError } = await supabaseAdmin
      .from("nutrition_plans")
      .update({ effective_until: clientToday, updated_at: new Date().toISOString() })
      .eq("id", covering.id);
    if (closeError) {
      throw new NutritionPlanError(
        `Failed to close the covering nutrition version: ${closeError.message}`,
        500
      );
    }
  }

  return { planId: covering?.id ?? queuedIds[0] };
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

  // The profile's TDEE, verbatim. This branch used to recompute it from
  // bmr x activity, so a custom-macros plan discarded a coach's custom TDEE
  // exactly like the calculated branch did — the same bug, one function down.
  const tdee = tdeeValue;

  const newPlanId = await createNutritionPlan({
    clientId,
    coachId,
    // The same client-local today the route's past-date guard judged
    // (threaded via calcInputs.today) — the RPC's belt compares
    // effectiveFrom against it, so a recompute here could straddle client
    // midnight and fail a save the route accepted.
    clientToday,
    workActivityLevel: calcInputs.workActivityLevel,
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
    effectiveFrom: body.effectiveFrom,
  });

  if (!newPlanId) {
    throw new NutritionPlanError("Failed to create nutrition plan", 500);
  }

  // Versioned plan (migration 144): the RPC closed/absorbed the open version
  // and returned the version now governing [effectiveDate, ∞) — regenerate
  // that window's events from its prescription. Days before effectiveDate
  // belong to earlier versions and are untouched.
  const effectiveDate = body.effectiveFrom ?? clientToday;
  await regenerateEventsOrThrow(clientId, newPlanId, effectiveDate);
  await recordCoachNoteOrThrow(
    clientId,
    coachId,
    newPlanId,
    effectiveDate,
    validatedData.coachNotes
  );

  return {
    success: true,
    plan: {
      calorieTarget: body.customCalories,
      proteinTargetG: body.customProteinG,
      carbTargetG: body.customCarbG,
      fatTargetG: body.customFatG,
      adjustedTdee: tdee,
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

  // Only to distinguish an "initial" plan from a "regenerated" one. Order +
  // limit because the versioned model (migration 144) legitimately holds
  // several active rows — a bare maybeSingle() would error on any chain. The
  // error is destructured and logged (house rule): a failed read defaults the
  // label to "initial", which is cosmetic, but it must never be silent.
  const { data: existingPlan, error: existingPlanError } = await supabaseAdmin
    .from("nutrition_plans")
    .select("id")
    .eq("client_id", clientId)
    .eq("status", "active")
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingPlanError) {
    console.error("Failed to read existing nutrition plan for regeneration_reason:", existingPlanError);
  }

  // THE contract of this rework: the browser previewed the plan by calling this
  // exact pure function over these exact inputs, so what the coach saw is what
  // lands. There is deliberately no second code path here — the old
  // preserve-calories branch skipped the calculator entirely and reused the
  // stored baseline, which meant the numbers on screen were not the numbers
  // saved. "Edit manually" covers that intent honestly: the coach types the
  // number they want and it is stored as the target.
  const plan = generateNutritionPlan({
    ...calcInputs,
    trainingVolumeHours: body.trainingVolumeHours,
    trainingPlan: null, // vestigial param (generateNutritionPlan ignores it)
    proteinTargetGPerKg: body.proteinTargetGPerKg,
    dietType: body.dietType,
  });
  const regenerationReason = existingPlan ? "regenerated" : "initial";

  const newPlanId = await createNutritionPlan({
    clientId,
    coachId,
    // Same threading as the custom-macro branch: the route-validated today.
    clientToday,
    workActivityLevel: calcInputs.workActivityLevel,
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
    effectiveFrom: body.effectiveFrom,
  });

  if (!newPlanId) {
    throw new NutritionPlanError("Failed to create nutrition plan", 500);
  }

  // Versioned plan (migration 144): the RPC closed/absorbed the open version
  // and returned the version now governing [effectiveDate, ∞) — regenerate
  // that window's events from its prescription. Days before effectiveDate
  // belong to earlier versions and are untouched.
  const effectiveDate = body.effectiveFrom ?? clientToday;
  await regenerateEventsOrThrow(clientId, newPlanId, effectiveDate);
  await recordCoachNoteOrThrow(
    clientId,
    coachId,
    newPlanId,
    effectiveDate,
    validatedData.coachNotes
  );

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
