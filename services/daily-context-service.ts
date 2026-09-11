/**
 * Daily Context Service
 * Provides today's training sessions, planned activities, and nutrition targets
 * for use in daily log entry and context display.
 */

import { supabaseAdmin } from "./supabase-admin";
import { getEventForDate } from "./training-event-service";
import {
  getNutritionTargetsForDateRange,
  type NutritionDayTarget,
} from "./nutrition-days-service";
import { getNutritionPlanIdForDate } from "./nutrition-plan-service";
import { getActiveTrainingPlanId } from "./training-service";

/**
 * The client's target on a specific date, from the day as COMPUTED (the version
 * covering the date, its grid row, the session on the date, the coach's edit),
 * through the client's display switches — the day reader's target over one
 * day. Returns null when no version covers the date — a gap between plans.
 * The food log stores no target: this is the answer for a logged day too.
 */
export const getPlanTargetForDate = async (
  clientId: string,
  date: string
): Promise<NutritionDayTarget | null> => {
  const targets = await getNutritionTargetsForDateRange(clientId, date, date);
  return targets.get(date) ?? null;
};

// ---------------------------------------------------------------------------
// Per-card write context + nutrition GET resolver (Session 3.1)
// ---------------------------------------------------------------------------

type PlanContextForDate = {
  nutritionPlanId: string | null;
  trainingPlanId: string | null;
};

/** The version a day's standing food log was stamped with, or null. */
async function standingNutritionLogStamp(
  clientId: string,
  date: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("nutrition_logs")
    .select("nutrition_plan_id")
    .eq("client_id", clientId)
    .eq("date", date)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to read the standing nutrition log: ${error.message}`);
  }
  return data?.nutrition_plan_id ?? null;
}

/**
 * Single resolver every per-card write calls to populate the child `*_plan_id`
 * links. The nutrition id is the version COVERING the log's date — the same
 * version a computed day derives from, so there is no day-row leg to prefer —
 * else, on a day the client has already started, the version their log was
 * stamped with; and the training id prefers the date-accurate event, then
 * falls back to the active plan. A backdated log stamps the version that
 * governed its own day, and a queued save never mis-stamps today's log with
 * the future version's id.
 */
export const resolvePlanContextForDate = async (
  clientId: string,
  date: string
): Promise<PlanContextForDate> => {
  // nutrition_plan_id is written by upsertNutritionLog: the version covering
  // the log's date, never a date-blind singleton read. A pre-start day (a
  // queued-first-plan client) and a gap after a delete have no covering
  // version, so the stamp is null and the guard below rejects the write: a
  // client cannot START logging nutrition on a day with no target.
  const [coveringVersionId, trainingEvent] = await Promise.all([
    getNutritionPlanIdForDate(clientId, date),
    getEventForDate(clientId, date),
  ]);

  // A day the client has already started stays open (owner, 2026-09-11): the
  // coach may end or replace today's plan, and the client keeps logging the
  // day they began, under the version their log was stamped with — so a day
  // no version covers takes the standing log's own stamp, and the writer keeps
  // the target it was logged under. A day with neither a covering version nor
  // a log stays null, and the guard refuses it.
  const nutritionPlanId =
    coveringVersionId ?? (await standingNutritionLogStamp(clientId, date));

  // training_plan_id prefers the date's event, then falls back to the active
  // plan so the per-card training write (Session 5.3) links even on a no-event
  // day. Uses the lightweight id-only getActiveTrainingPlanId (NOT the heavy
  // getActiveTrainingPlan, which loads sessions+exercises). Deliberately
  // untouched by the nutrition versioning work: its today-anchor (rather than
  // `date`) is a separate, pre-existing observation recorded in the Session 1B
  // STATUS block.
  const trainingPlanId =
    trainingEvent?.trainingPlanId ?? (await getActiveTrainingPlanId(clientId));

  return { nutritionPlanId, trainingPlanId };
};

/**
 * Per-card resource whose plan-id presence we assert before writing a log. Wellness is
 * deliberately NOT gated (Session 3.1C): it has no plan and no adherence concept.
 */
type PlanGatedResource = "nutrition" | "training";

/**
 * Thrown by `assertHasActivePlan` when the client is not set up for the resource.
 * Routes translate `instanceof NoActivePlanError` into a 422 — perimeter guard against
 * logs from clients with no plan at all. Sibling to `DayLockedError`.
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
 * The orphan-log perimeter. Both resources reject a write whose `*_plan_id`
 * stamp would be null: nutrition → `nutrition_plan_id`, training →
 * `training_plan_id` (Session 5.3). A nutrition stamp is null exactly when no
 * version COVERS the log's date AND the client has not started the day — a
 * pre-start day for a queued-first-plan client, or a gap after a delete with
 * nothing logged on it — so the client cannot start logging nutrition when
 * there is no target that day, while a day they have begun stays open under
 * the stamp its log carries (owner, 2026-09-11). This is deliberately NARROWER
 * than activation-readiness, which is covering-OR-future: "is the client set
 * up?" (a queued first plan counts) and "can the client log TODAY?" (only a
 * covering version, or a day already begun, counts) are different questions
 * with legitimately different answers. Wellness writes are ungated — a
 * plan-less client logging mood/sleep is valid, not an orphan.
 */
export const assertHasActivePlan = (
  ctx: PlanContextForDate,
  resource: PlanGatedResource
): void => {
  const id = resource === "nutrition" ? ctx.nutritionPlanId : ctx.trainingPlanId;
  if (id == null) throw new NoActivePlanError(resource);
};

type NutritionForDate = {
  consumed: { calories: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null } | null;
  // `note` is the coach's per-day note, carried by the computed day.
  target: { calories: number; proteinG: number | null; carbsG: number | null; fatG: number | null; note?: string | null } | null;
  source: "log" | "event" | null;
};

/**
 * Resolve the nutrition card for a date. What the client ATE is the
 * `nutrition_logs` row, when one exists — a row existing = "logged" regardless
 * of values (distinguishes absent vs empty, which the daily_logs_full view
 * cannot) — and the TARGET for EVERY day, logged or not, is the computed day
 * (`getPlanTargetForDate`): the log stores no target, so a coach's change to
 * today and a session landing on a logged day reach this read at once.
 *   `source: "log"`   — a row exists; the target is the computed day or null
 *                        (a gap: the meals were logged with no target to judge).
 *   `source: "event"` — no row, a version covers the date: the target alone.
 *   `source: null`    — no row and no version: nothing on that day.
 */
export const getNutritionForDate = async (
  clientId: string,
  date: string
): Promise<NutritionForDate> => {
  const [{ data: logRow, error }, planTarget] = await Promise.all([
    supabaseAdmin
      .from("nutrition_logs")
      .select("calories_consumed, protein_g, carbs_g, fat_g")
      .eq("client_id", clientId)
      .eq("date", date)
      .maybeSingle(),
    getPlanTargetForDate(clientId, date),
  ]);
  if (error) {
    throw new Error(`Failed to read the nutrition log: ${error.message}`);
  }

  const target = planTarget
    ? {
        calories: planTarget.calories,
        proteinG: planTarget.proteinG,
        carbsG: planTarget.carbsG,
        fatG: planTarget.fatG,
        note: planTarget.note,
      }
    : null;

  if (logRow) {
    return {
      consumed: {
        calories: logRow.calories_consumed,
        proteinG: logRow.protein_g,
        carbsG: logRow.carbs_g,
        fatG: logRow.fat_g,
      },
      target,
      source: "log",
    };
  }

  return { consumed: null, target, source: target ? "event" : null };
};
