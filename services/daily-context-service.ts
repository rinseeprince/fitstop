/**
 * Daily Context Service
 * Provides today's training sessions, planned activities, and nutrition targets
 * for use in daily log entry and context display.
 */

import { supabaseAdmin } from "./supabase-admin";
import { getEventForDate } from "./training-event-service";
import { getNutritionEventForDate } from "./nutrition-event-service";
import { getActivePhase } from "./phase-service";
import { getActiveNutritionPlanId } from "./nutrition-plan-service";
import { getActiveTrainingPlanId } from "./training-service";
import { mapNutritionEventToDisplayTarget } from "@/utils/nutrition-event-helpers";

/**
 * Find the plan that was active on a specific date and return its daily target.
 * Resolves from the date's nutrition_event; returns null when there is no event (no template fallback exists yet).
 * Optional includeActivityBurn / surplusAsCarbs avoid repeated clients table queries when called in a loop.
 */
export type PlanDayTarget = {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  isTrainingDay: boolean;
  note: string | null;
};

export const getPlanTargetForDate = async (
  clientId: string,
  date: string,
  includeActivityBurn?: boolean,
  surplusAsCarbs?: boolean
): Promise<PlanDayTarget | null> => {
  // Resolve the display prefs once if not passed by caller (single query).
  let burnFlag = includeActivityBurn;
  let splitFlag = surplusAsCarbs;
  if (burnFlag === undefined || splitFlag === undefined) {
    const { data: clientRow } = await supabaseAdmin
      .from("clients").select("include_activity_burn, surplus_as_carbs").eq("id", clientId).single();
    if (burnFlag === undefined) burnFlag = clientRow?.include_activity_burn !== false;
    if (splitFlag === undefined) splitFlag = clientRow?.surplus_as_carbs ?? false;
  }

  const event = await getNutritionEventForDate(clientId, date);
  if (!event) return null;

  // Reuse the calendar mapper so the per-day lane (and the weekly denominators
  // it feeds) split a training surplus the same way the program card + calendar
  // do — protein held; surplusAsCarbs decides carbs-only vs keep-split. Calories
  // are unchanged by the split, so adherence is unaffected.
  const target = mapNutritionEventToDisplayTarget(event, burnFlag, splitFlag);
  return {
    calories: target.calories,
    proteinG: target.proteinG,
    carbsG: target.carbsG,
    fatG: target.fatG,
    isTrainingDay: target.isTrainingDay,
    note: event.note ?? null,
  };
};

// ---------------------------------------------------------------------------
// Per-card write context + nutrition GET resolver (Session 3.1)
// ---------------------------------------------------------------------------

export type PlanContextForDate = {
  phaseId: string | null;
  nutritionPlanId: string | null;
  trainingPlanId: string | null;
};

/**
 * Single resolver every per-card write calls to populate `daily_logs.phase_id` and the
 * child `*_plan_id` links. Each id prefers the date-accurate event, then falls back to
 * the client's active plan, so the link is populated even on a no-event day.
 */
export const resolvePlanContextForDate = async (
  clientId: string,
  date: string
): Promise<PlanContextForDate> => {
  const [phase, nutritionEvent, trainingEvent] = await Promise.all([
    getActivePhase(clientId),
    getNutritionEventForDate(clientId, date),
    getEventForDate(clientId, date),
  ]);

  // Currently-active phase, not phase-as-of-date. A past-unlogged backfill can therefore
  // stamp the current phase onto a day it didn't cover — the day-lock only protects
  // already-logged days. Tolerable: no reader keys logs on phase_id (all are date-windowed).
  const phaseId = phase?.id ?? null;

  // nutrition_plan_id is written by upsertNutritionLog, so fall back to the active plan
  // when the day has no nutrition event.
  const nutritionPlanId =
    nutritionEvent?.nutritionPlanId ?? (await getActiveNutritionPlanId(clientId));

  // training_plan_id prefers the date's event, then falls back to the active
  // plan so the per-card training write (Session 5.3) links even on a no-event
  // day. Uses the lightweight id-only getActiveTrainingPlanId (NOT the heavy
  // getActiveTrainingPlan, which loads sessions+exercises).
  const trainingPlanId =
    trainingEvent?.trainingPlanId ?? (await getActiveTrainingPlanId(clientId));

  return { phaseId, nutritionPlanId, trainingPlanId };
};

/**
 * Per-card resource whose plan-id presence we assert before writing a log. Wellness is
 * deliberately NOT gated (Session 3.1C): it has no plan, no adherence, and links via the
 * nullable spine `phase_id` — null is first-class under opt-in roadmaps.
 */
export type PlanGatedResource = "nutrition" | "training";

/**
 * Thrown by `assertHasActivePlan` when the plan id we'd stamp onto the log row is null.
 * Routes translate `instanceof NoActivePlanError` into a 422 — perimeter guard against
 * nutrition/training logs with no plan to score against (their `*_plan_id` stamps feed
 * the adherence reads). Sibling to `DayLockedError`.
 */
export class NoActivePlanError extends Error {
  readonly resource: PlanGatedResource;

  constructor(resource: PlanGatedResource) {
    super(`No active plan for ${resource}`);
    this.name = "NoActivePlanError";
    this.resource = resource;
  }
}

/**
 * Reject the write when the plan id we'd stamp would be null: nutrition →
 * `nutrition_plan_id`, training → `training_plan_id` (Session 5.3). Wellness writes are
 * ungated — a no-phase client logging mood/sleep is valid, not an orphan.
 */
export const assertHasActivePlan = (
  ctx: PlanContextForDate,
  resource: PlanGatedResource
): void => {
  const id = resource === "nutrition" ? ctx.nutritionPlanId : ctx.trainingPlanId;
  if (id == null) throw new NoActivePlanError(resource);
};

export type NutritionForDate = {
  consumed: { calories: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null } | null;
  // `note` is the coach's per-day note (event source only — a logged day reads
  // the frozen nutrition_logs snapshot, which has no note column).
  target: { calories: number; proteinG: number | null; carbsG: number | null; fatG: number | null; note?: string | null } | null;
  source: "log" | "event" | null;
};

/**
 * Resolve the nutrition card for a date by the ARCHITECTURE three-level priority:
 *   1. Logged day  → the snapshot in `nutrition_logs` (authoritative).
 *   2. Unlogged + event → the `nutrition_event` target (via getPlanTargetForDate).
 *   3. Unlogged + no event → null (level-3 template fallback is unbuilt — ARCHITECTURE:258).
 * A `nutrition_logs` row existing = "logged" regardless of values (distinguishes absent vs
 * empty, which the daily_logs_full view cannot).
 */
export const getNutritionForDate = async (
  clientId: string,
  date: string
): Promise<NutritionForDate> => {
  const { data: logRow } = await supabaseAdmin
    .from("nutrition_logs")
    .select(
      "calories_consumed, protein_g, carbs_g, fat_g, target_calories, target_protein_g, target_carbs_g, target_fat_g"
    )
    .eq("client_id", clientId)
    .eq("date", date)
    .maybeSingle();

  if (logRow) {
    return {
      consumed: {
        calories: logRow.calories_consumed,
        proteinG: logRow.protein_g,
        carbsG: logRow.carbs_g,
        fatG: logRow.fat_g,
      },
      target:
        logRow.target_calories != null
          ? {
              calories: logRow.target_calories,
              proteinG: logRow.target_protein_g,
              carbsG: logRow.target_carbs_g,
              fatG: logRow.target_fat_g,
            }
          : null,
      source: "log",
    };
  }

  const planTarget = await getPlanTargetForDate(clientId, date);
  if (planTarget) {
    return {
      consumed: null,
      target: {
        calories: planTarget.calories,
        proteinG: planTarget.proteinG,
        carbsG: planTarget.carbsG,
        fatG: planTarget.fatG,
        note: planTarget.note,
      },
      source: "event",
    };
  }

  return { consumed: null, target: null, source: null };
};
