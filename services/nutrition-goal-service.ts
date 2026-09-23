import { getClientTodayString } from "./today-service";
import { getGoalForDate, listClientGoals } from "./client-goals-service";
import { resolveNutritionCalcInputs } from "./nutrition-calc-inputs";
import { getNutritionVersionGoalsFrom, recordNutritionVersionKept } from "./nutrition-plan-service";
import { findNutritionOutOfDate } from "@/lib/nutrition/nutrition-out-of-date";
import type { Client } from "@/types/check-in";
import type { NutritionGoalForDay, NutritionOutOfDateRead } from "@/types/nutrition-goal";

/**
 * How nutrition follows the goal (docs/MEASUREMENT-LOG-PLAN.md §6 commit 8d1):
 * the drawer prices a plan for the goal in force on the day it takes effect,
 * and one rule says when a saved version no longer fits the goal on its days.
 * The routes under `/api/clients/[id]/nutrition/goal` call these after proving
 * the coach owns the client; every read is scoped by that client's id.
 */

/**
 * The goal in force on `day` and the calculator's inputs for it — what the
 * drawer shows on its Goal line and previews for its Starts on, from the same
 * resolver the save runs, so the two agree.
 */
export async function getNutritionGoalForDay(
  clientId: string,
  client: Client,
  day: string
): Promise<NutritionGoalForDay> {
  const [today, goal] = await Promise.all([
    getClientTodayString(clientId),
    getGoalForDate(clientId, day),
  ]);
  const calcInputs = await resolveNutritionCalcInputs(clientId, client, { today, day, goal });
  return { date: day, goal, calcInputs };
}

/**
 * The out-of-date rule's answer for the client: their versions with a day
 * left, their goals, judged from their today (`findNutritionOutOfDate`).
 */
export async function getNutritionOutOfDate(clientId: string): Promise<NutritionOutOfDateRead> {
  const clientToday = await getClientTodayString(clientId);
  const [versions, goals] = await Promise.all([
    getNutritionVersionGoalsFrom(clientId, clientToday),
    listClientGoals(clientId),
  ]);
  return { clientToday, outOfDate: findNutritionOutOfDate(versions, goals, clientToday) };
}

/** What the coach closed is no longer the notice: the goal or the plan moved. */
export class NutritionNoticeChangedError extends Error {}

/**
 * The coach closes the out-of-date notice (the ×): the version's calories are
 * kept for the goal the notice compared them with (migration 197). The rule is
 * recomputed here and ITS answer recorded — never a goal sent by the browser —
 * and a notice that has changed since the coach saw it is refused, so the
 * browser shows the current one instead.
 */
export async function keepNutritionForGoal(
  clientId: string,
  coachId: string,
  closed: { versionId: string; fromDay: string }
): Promise<void> {
  const { outOfDate } = await getNutritionOutOfDate(clientId);
  if (!outOfDate || outOfDate.versionId !== closed.versionId || outOfDate.fromDay !== closed.fromDay) {
    throw new NutritionNoticeChangedError("The notice has changed");
  }
  await recordNutritionVersionKept(outOfDate.versionId, outOfDate.goal, coachId);
}
