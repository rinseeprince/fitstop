import { getClientById } from "@/services/client-service";
import { generateNutritionPlan } from "@/services/nutrition-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import {
  resolveNutritionCalcInputs,
  type NutritionCalcInputs,
} from "@/services/nutrition-calc-inputs";
import {
  createNutritionPlan,
  resolveNutritionPlacementEnd,
} from "@/services/nutrition-plan-service";
import { CUSTOM_MACRO_CALORIE_TOLERANCE } from "@/lib/constants";
import type { GenerateNutritionPlanRequest } from "@/types/check-in";
import { getClientTodayString } from "@/services/today-service";
import { clearNutritionPlansForClient } from "@/services/nutrition-plan-clear-service";
import {
  NutritionLogRerecordError,
  rerecordNutritionLogTarget,
} from "@/services/daily-log-card-service";

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

interface NutritionPlanResult {
  success: true;
  plan: Record<string, unknown>;
}

/**
 * The coach's note for a save, as the RPC takes it (migration 172): trimmed, and
 * absent when blank. It is one of the save's arguments, so it lands with the
 * version or not at all — and a same-day re-save's note replaces the version's,
 * empty included: the note is the latest save's.
 */
const coachNoteOf = (validatedData: { coachNotes?: string }): string | undefined =>
  validatedData.coachNotes?.trim() || undefined;

/**
 * Delete the client's nutrition plan: a save of nothing from today. The
 * running version ends yesterday and keeps its past, queued versions are
 * archived, finished ones are untouched — the training clear's shape
 * (`clearNutritionPlansForClient`, migration 167). A day's target is computed
 * from the version covering it, so ending the versions IS removing the days:
 * past days keep their version, on the calendar and on every block it ran in,
 * and from today nothing covers a day — the hero, the Overview and the
 * client's Program tab all read "no plan" the moment it lands, and a day the
 * client has not begun refuses their food log (a today they have already
 * logged stays open under the target it was logged under).
 *
 * Throws NutritionPlanError for ownership / not-found failures, and 404 when
 * nothing is running or queued — which also makes a same-day second delete a
 * clean 404 rather than a silent success.
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

  const clientToday = await getClientTodayString(clientId);
  const { versionsCleared, versionIds } = await clearNutritionPlansForClient(
    clientId,
    clientToday
  );

  if (versionsCleared === 0) {
    throw new NutritionPlanError("No active nutrition plan to delete", 404);
  }

  // The earliest retired version — the one the client was on, when a running
  // version existed — names the act in the audit trail.
  return { planId: versionIds[0] };
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
  // the goal resolver must agree with the RPC's past-date belt and its
  // placement decision (migration 166), or a coach near local midnight gets a
  // spurious "past date" rejection.
  const clientToday = await getClientTodayString(clientId);

  // The day the version takes effect: the coach's pick, else today. The past
  // is refused — here and again by the RPC's own belt — and nothing else
  // bounds the start (owner, 2026-09-11): today is the coach's to replace
  // whatever the client has eaten, so a version starts on any day from their
  // today, and a today they have already logged is re-recorded below. The
  // deletion floor is training's alone.
  const effectiveDate = body.effectiveFrom ?? clientToday;
  if (effectiveDate < clientToday) {
    throw new NutritionPlanError("Effective date cannot be in the past", 400);
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

  // The placement's window. Its END is resolved here, once, the way a training
  // program's is at placement — the block covering the start, else the furthest
  // live program's end, else the fixed fallback — capped at the next queued
  // version (migration 166). Both handlers hand it to the RPC, which stores it
  // on the row; every day inside the window is then computed from the row, so
  // the window and the days it answers for are one thing by construction.
  const effectiveUntil = await resolveNutritionPlacementEnd(clientId, effectiveDate);

  const result = body.customMacrosEnabled
    ? await handleCustomMacros(clientId, coachId, body, calcInputs, validatedData, effectiveUntil)
    : await handleCalculatedPlan(
        clientId,
        coachId,
        body,
        client,
        calcInputs,
        validatedData,
        effectiveUntil
      );

  // Replacing today re-records today's log (owner, 2026-09-11): when the
  // version's window covers the client's today, a today they have already
  // logged is re-snapshotted onto their log at once, the way their own save
  // does it, so the history table, the calendar, their day and the check-in
  // week read the new target with the logged meals on top. Never a past day
  // — a past start is refused above. The version is stored by now either way;
  // a failure here says exactly that rather than "failed to save".
  if (effectiveDate <= clientToday && effectiveUntil >= clientToday) {
    try {
      await rerecordNutritionLogTarget(clientId, clientToday);
    } catch (error) {
      if (error instanceof NutritionLogRerecordError) {
        throw new NutritionPlanError(error.message, 500);
      }
      throw error;
    }
  }

  return result;
}

async function handleCustomMacros(
  clientId: string,
  coachId: string,
  body: GenerateNutritionPlanRequest,
  calcInputs: ReadyCalcInputs,
  validatedData: { coachNotes?: string },
  effectiveUntil: string
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
      `Custom calories must be within ±${CUSTOM_MACRO_CALORIE_TOLERANCE} calories of macro totals (calculated: ${calculatedCalories} cal)`,
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
    coachNote: coachNoteOf(validatedData),
    trainingPlan: null, // vestigial param (createNutritionPlan ignores it)
    effectiveFrom: body.effectiveFrom,
    effectiveUntil,
  });

  if (!newPlanId) {
    throw new NutritionPlanError("Failed to create nutrition plan", 500);
  }

  // The RPC capped the predecessor (or replaced a same-day version in place)
  // and returned the version now governing the window, its note included. Its
  // days are computed from the row from here on; days before the start belong
  // to earlier versions and are untouched.

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
  validatedData: { coachNotes?: string },
  effectiveUntil: string
): Promise<NutritionPlanResult> {
  const { currentWeightKg, bmr, today: clientToday } = calcInputs;

  // Only to distinguish an "initial" plan from a "regenerated" one. Order +
  // limit because the placement model legitimately holds several active rows
  // — a bare maybeSingle() would error on any client with history. The error
  // is destructured and logged (house rule): a failed read defaults the label
  // to "initial", which is cosmetic, but it must never be silent.
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
  // The day the plan takes effect: the version's window starts here (the RPC),
  // the events regenerate from here, and — docs/MEASUREMENT-LOG-PLAN.md commit
  // 8bb — the deficit is spread from here to the deadline, in the drawer's
  // preview and in this save alike. A cut queued four weeks out used to be
  // costed from the day it was saved, understating its deficit by four weeks.
  const effectiveDate = body.effectiveFrom ?? clientToday;

  const plan = generateNutritionPlan({
    ...calcInputs,
    trainingVolumeHours: body.trainingVolumeHours,
    trainingPlan: null, // vestigial param (generateNutritionPlan ignores it)
    proteinTargetGPerKg: body.proteinTargetGPerKg,
    dietType: body.dietType,
    startDate: effectiveDate,
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
    coachNote: coachNoteOf(validatedData),
    trainingPlan: null, // vestigial param (createNutritionPlan ignores it)
    effectiveFrom: body.effectiveFrom,
    effectiveUntil,
  });

  if (!newPlanId) {
    throw new NutritionPlanError("Failed to create nutrition plan", 500);
  }

  // The RPC capped the predecessor (or replaced a same-day version in place)
  // and returned the version now governing [effectiveDate, effectiveUntil], its
  // note included. Its days are computed from the row from here on; days before
  // effectiveDate belong to earlier versions and are untouched.

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
