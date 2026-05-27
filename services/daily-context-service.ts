/**
 * Daily Context Service
 * Provides today's training sessions, planned activities, and nutrition targets
 * for use in daily log entry and context display.
 */

import { supabaseAdmin } from "./supabase-admin";
import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";
import { getEventForDate } from "./training-event-service";
import { getTodayDateString } from "@/lib/date-helpers";
import { getNutritionEventForDate } from "./nutrition-event-service";
import { getActivePhase } from "./phase-service";
import { getActiveNutritionPlanId } from "./nutrition-plan-service";
import { getTotalCalories, mapNutritionEventToDisplayTarget } from "@/utils/nutrition-event-helpers";

type TodaysTrainingSession = {
  sessionId: string;
  sessionName: string;
  estimatedCalories: number;
} | null;

export const getTodaysTrainingSession = async (clientId: string, date?: string): Promise<TodaysTrainingSession> => {
  const dateStr = date ?? getTodayDateString();
  const event = await getEventForDate(clientId, dateStr);
  if (!event) return null;
  return {
    sessionId: event.trainingSessionId ?? event.id,
    sessionName: event.sessionName,
    estimatedCalories: event.estimatedCalories ?? 0,
  };
};

export const getTodaysNutritionTarget = async (clientId: string, date?: string): Promise<DailyNutritionTargets | null> => {
  const dateStr = date ?? getTodayDateString();
  const event = await getNutritionEventForDate(clientId, dateStr);

  if (!event) return null;

  const { data: clientRow } = await supabaseAdmin
    .from("clients").select("include_activity_burn").eq("id", clientId).single();
  const includeActivityBurn = clientRow?.include_activity_burn !== false;
  const target = mapNutritionEventToDisplayTarget(event, includeActivityBurn);
  return { ...target, planId: event.nutritionPlanId, includeActivityBurn };
};

/**
 * Find the plan that was active on a specific date and return its daily target.
 * Resolves from the date's nutrition_event; returns null when there is no event (no template fallback exists yet).
 * Optional includeActivityBurn avoids repeated clients table queries when called in a loop.
 */
export type PlanDayTarget = {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  isTrainingDay: boolean;
};

export const getPlanTargetForDate = async (
  clientId: string,
  date: string,
  includeActivityBurn?: boolean
): Promise<PlanDayTarget | null> => {
  // Resolve includeActivityBurn once if not passed by caller
  let burnFlag = includeActivityBurn;
  if (burnFlag === undefined) {
    const { data: clientRow } = await supabaseAdmin
      .from("clients").select("include_activity_burn").eq("id", clientId).single();
    burnFlag = clientRow?.include_activity_burn !== false;
  }

  const event = await getNutritionEventForDate(clientId, date);
  if (!event) return null;

  return {
    calories: getTotalCalories(event, burnFlag),
    proteinG: event.proteinG,
    carbsG: event.carbG,
    fatG: event.fatG,
    isTrainingDay: event.isTrainingDay,
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

  // Currently-active phase, not phase-as-of-date. The only divergence (a past-unlogged
  // backfill that crosses a phase boundary) is gated out by no-plan gating + daily logging.
  const phaseId = phase?.id ?? null;

  // nutrition_plan_id is written by upsertNutritionLog, so fall back to the active plan
  // when the day has no nutrition event.
  const nutritionPlanId =
    nutritionEvent?.nutritionPlanId ?? (await getActiveNutritionPlanId(clientId));

  // From the date's training event only. Nothing in Session 3.1 writes training_plan_id;
  // the active-plan fallback is deferred to Session 5.3's training writer (getActiveTrainingPlan
  // loads sessions+exercises — too heavy to call on every per-card write here).
  const trainingPlanId = trainingEvent?.trainingPlanId ?? null;

  return { phaseId, nutritionPlanId, trainingPlanId };
};

/** Per-card resource whose plan-id presence we assert before writing a log. */
export type PlanGatedResource = "nutrition" | "wellness" | "training";

/**
 * Thrown by `assertHasActivePlan` when the plan id we'd stamp onto the log row is null.
 * Routes translate `instanceof NoActivePlanError` into a 422 — perimeter guard against
 * orphan logs (null `phase_id` / `*_plan_id`) that surface as null adherence in the
 * attention feed and are excluded from phase reviews. Sibling to `DayLockedError`.
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
 * Reject the write when the field we'd stamp would be null. Per-resource because each
 * writer stamps a different id: nutrition → `nutrition_plan_id`, wellness → `phase_id`
 * (no plan id, links via phase), training → `training_plan_id` (Session 5.3).
 */
export const assertHasActivePlan = (
  ctx: PlanContextForDate,
  resource: PlanGatedResource
): void => {
  const id =
    resource === "nutrition"
      ? ctx.nutritionPlanId
      : resource === "training"
        ? ctx.trainingPlanId
        : ctx.phaseId;
  if (id == null) throw new NoActivePlanError(resource);
};

export type NutritionForDate = {
  consumed: { calories: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null } | null;
  target: { calories: number; proteinG: number | null; carbsG: number | null; fatG: number | null } | null;
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
      },
      source: "event",
    };
  }

  return { consumed: null, target: null, source: null };
};
