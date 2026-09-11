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

/**
 * Single resolver every per-card write calls to populate the child `*_plan_id`
 * links. The nutrition id is the version COVERING the log's date — the same
 * version a computed day derives from, so there is no day-row leg to prefer;
 * null on a day no version covers, and the meal still saves without a stamp.
 * The training id prefers the date-accurate event, then falls back to the
 * active plan. A backdated log stamps the version that governed its own day,
 * and a queued save never mis-stamps today's log with the future version's id.
 */
export const resolvePlanContextForDate = async (
  clientId: string,
  date: string
): Promise<PlanContextForDate> => {
  // nutrition_plan_id is written by upsertNutritionLog: the version covering
  // the log's date, never a date-blind singleton read. A pre-start day (a
  // queued-first-plan client) and a gap after a delete have no covering
  // version, so the stamp is null — provenance the writer omits, and nothing
  // a reader judges adherence by.
  const [coveringVersionId, trainingEvent] = await Promise.all([
    getNutritionPlanIdForDate(clientId, date),
    getEventForDate(clientId, date),
  ]);

  // training_plan_id prefers the date's event, then falls back to the active
  // plan so the per-card training write (Session 5.3) links even on a no-event
  // day. Uses the lightweight id-only getActiveTrainingPlanId (NOT the heavy
  // getActiveTrainingPlan, which loads sessions+exercises). Deliberately
  // untouched by the nutrition versioning work: its today-anchor (rather than
  // `date`) is a separate, pre-existing observation recorded in the Session 1B
  // STATUS block.
  const trainingPlanId =
    trainingEvent?.trainingPlanId ?? (await getActiveTrainingPlanId(clientId));

  return { nutritionPlanId: coveringVersionId, trainingPlanId };
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
