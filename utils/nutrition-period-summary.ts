/**
 * The nutrition period kernel — the ONE computation of a period's nutrition
 * figures. Two pure functions, no database client:
 *
 *   buildNutritionSummary   dates + what was eaten + each day's computed target
 *                           → one row per date (the shape the check-in freezes)
 *   summarizeNutritionPeriod rows → every figure a surface renders
 *
 * Every surface reads this and computes nothing of its own: the Overview
 * rail, the check-in ribbon and its nutrition card, the client's check-in
 * wizard, the columns and snapshot a submit stores, and the AI prompt. A
 * submitted check-in's summary is this function over its frozen rows, so the
 * rows are the only thing that needs freezing.
 *
 * Three day sets, and every figure names its own (owner decision 2026-09-11):
 *
 *   LOGGED    days with a food log — coverage, over the PERIOD's days
 *   TARGETED  days a target was prescribed — the adherence denominator; an
 *             unlogged targeted day is a miss, exactly as a scheduled session
 *             the client skipped is a miss on the training side
 *   JUDGED    logged AND targeted — the only days that can be compared, so
 *             every average of intake against target divides by these
 *
 * A logged day no target covers is counted as logged and nothing else: it is
 * in no ratio's numerator and no ratio's denominator. The coach prescribed
 * nothing that day, so there was nothing to hit and nothing to miss. It
 * reaches the surfaces only as `loggedNoTargetDays`, so a card can say where
 * the day went.
 */

import type { DayOfWeek } from "@/types/check-in";
import type { NutritionDay, NutritionDayStatus } from "@/types/schedule";
import type { NutritionLogRow } from "@/services/schedule-data-service";
import type { NutritionDayTarget } from "@/services/nutrition-days-service";
import { calculateNutritionAdherence } from "@/lib/nutrition-verdict";
import {
  WEEKLY_NUTRITION_HIT_PER_DAY,
  WEEKLY_NUTRITION_PARTIAL_PER_DAY,
} from "@/lib/constants";

const DAY_NAMES: Record<number, DayOfWeek> = {
  0: "sunday", 1: "monday", 2: "tuesday", 3: "wednesday",
  4: "thursday", 5: "friday", 6: "saturday",
};

function getDayOfWeek(dateStr: string): DayOfWeek {
  return DAY_NAMES[new Date(dateStr + "T00:00:00").getDay()];
}

/**
 * A day's standing. No target outranks everything: a day the coach
 * prescribed nothing for has nothing to judge, logged or not. Then the log,
 * then the ONE per-day verdict every reader shares (`calculateNutritionAdherence`,
 * 50 / 200 kcal). A logged zero has no verdict under that definition and
 * reads as not logged, as it does on every other surface.
 */
function classifyDay(actual: number | null, target: number | null): NutritionDayStatus {
  if (target == null) return "no_target";
  if (actual == null) return "not_logged";
  return calculateNutritionAdherence(actual, target) ?? "not_logged";
}

/**
 * One row per date: what the client ate from the log, the target from the
 * COMPUTED day for every date, logged or not — the log stores no target — and
 * the standing derived from the two.
 */
export function buildNutritionSummary(
  dates: string[],
  nutritionLogs: NutritionLogRow[],
  targets: ReadonlyMap<string, NutritionDayTarget>
): NutritionDay[] {
  const logsByDate = new Map<string, NutritionLogRow>();
  for (const log of nutritionLogs) {
    logsByDate.set(log.date, log);
  }

  return dates.map((date): NutritionDay => {
    const log = logsByDate.get(date) ?? null;
    const target = targets.get(date) ?? null;
    const actualCalories = log?.caloriesConsumed ?? null;
    const targetCalories = target?.calories ?? null;

    return {
      date,
      dayOfWeek: getDayOfWeek(date),
      status: classifyDay(actualCalories, targetCalories),
      targetCalories,
      targetProteinG: target?.proteinG ?? null,
      targetCarbsG: target?.carbsG ?? null,
      targetFatG: target?.fatG ?? null,
      actualCalories,
      actualProteinG: log?.proteinG ?? null,
      actualCarbsG: log?.carbsG ?? null,
      actualFatG: log?.fatG ?? null,
    };
  });
}

type NutritionMacroTotals = {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

type NutritionPeriodVerdict = "hit" | "partial" | "missed";

export type NutritionPeriodSummary = {
  /** The period's day count. */
  periodDays: number;
  /** LOGGED — days with a food log. Coverage, over `periodDays`. */
  loggedDays: number;
  /** TARGETED — days a target was prescribed. The adherence denominator. */
  targetedDays: number;
  /** JUDGED — logged and targeted. The only days intake can be compared. */
  judgedDays: number;
  /** Logged days no target covered — counted as logged and nothing else. */
  loggedNoTargetDays: number;
  /** Judged days within the per-day hit threshold of their target. */
  onTarget: number;
  /** Judged days that missed the threshold, by the side they landed on. */
  over: number;
  under: number;
  /** `onTarget` over `targetedDays`, whole percent; null with no targeted day. */
  daysOnTargetPct: number | null;
  /** The targets summed over every targeted day, logged or not; null with none. */
  targetTotals: NutritionMacroTotals | null;
  /**
   * Intake summed over the judged days — the targeted days that were logged.
   * An unlogged targeted day contributes nothing here and its whole target
   * above, which is what makes a skipped day count against the client. Null
   * with no targeted day.
   */
  consumedOnTargetedDays: NutritionMacroTotals | null;
  /** `consumedOnTargetedDays` over `targetTotals`, calories, one decimal; null with no targeted day. */
  calorieAdherencePct: number | null;
  /**
   * Did the period land near its target: the calorie gap over the targeted
   * days against the per-day thresholds scaled by `targetedDays`. Null with
   * no targeted day.
   */
  periodVerdict: NutritionPeriodVerdict | null;
  /** Per judged day, whole numbers: intake against the target that applied that day. Null with none. */
  perJudgedDay: { consumed: NutritionMacroTotals; target: NutritionMacroTotals } | null;
  /** Per logged day, whole numbers: what they ate, targeted or not. Null with no logged day. */
  intakePerLoggedDay: NutritionMacroTotals | null;
  /** Σ (intake − target) over the judged days; null with none. */
  netCaloriesOnJudgedDays: number | null;
};

const zero = (): NutritionMacroTotals => ({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });

function add(
  into: NutritionMacroTotals,
  calories: number | null,
  proteinG: number | null,
  carbsG: number | null,
  fatG: number | null
): void {
  into.calories += calories ?? 0;
  into.proteinG += proteinG ?? 0;
  into.carbsG += carbsG ?? 0;
  into.fatG += fatG ?? 0;
}

function perDay(totals: NutritionMacroTotals, days: number): NutritionMacroTotals {
  return {
    calories: Math.round(totals.calories / days),
    proteinG: Math.round(totals.proteinG / days),
    carbsG: Math.round(totals.carbsG / days),
    fatG: Math.round(totals.fatG / days),
  };
}

/** Every figure a surface renders, from the rows — and from nothing else. */
export function summarizeNutritionPeriod(days: NutritionDay[]): NutritionPeriodSummary {
  let loggedDays = 0;
  let targetedDays = 0;
  let judgedDays = 0;
  let onTarget = 0;
  let over = 0;
  let under = 0;
  const targetTotals = zero();
  // Intake on the targeted days IS intake on the judged days: an unlogged
  // targeted day has nothing to add.
  const consumedOnTargetedDays = zero();
  const targetOnJudgedDays = zero();
  const intake = zero();
  let net = 0;

  for (const day of days) {
    const logged = day.actualCalories != null;
    const targeted = day.targetCalories != null;

    if (logged) {
      loggedDays++;
      add(intake, day.actualCalories, day.actualProteinG, day.actualCarbsG, day.actualFatG);
    }
    if (targeted) {
      targetedDays++;
      add(targetTotals, day.targetCalories, day.targetProteinG, day.targetCarbsG, day.targetFatG);
    }
    if (!logged || !targeted) continue;

    judgedDays++;
    add(consumedOnTargetedDays, day.actualCalories, day.actualProteinG, day.actualCarbsG, day.actualFatG);
    add(targetOnJudgedDays, day.targetCalories, day.targetProteinG, day.targetCarbsG, day.targetFatG);
    net += day.actualCalories! - day.targetCalories!;

    if (day.status === "hit") onTarget++;
    else if (day.actualCalories! > day.targetCalories!) over++;
    else under++;
  }

  const hasTargets = targetedDays > 0;
  const calorieGap = Math.abs(consumedOnTargetedDays.calories - targetTotals.calories);
  const periodVerdict: NutritionPeriodVerdict | null = !hasTargets
    ? null
    : calorieGap <= WEEKLY_NUTRITION_HIT_PER_DAY * targetedDays
      ? "hit"
      : calorieGap <= WEEKLY_NUTRITION_PARTIAL_PER_DAY * targetedDays
        ? "partial"
        : "missed";

  return {
    periodDays: days.length,
    loggedDays,
    targetedDays,
    judgedDays,
    loggedNoTargetDays: loggedDays - judgedDays,
    onTarget,
    over,
    under,
    daysOnTargetPct: hasTargets ? Math.round((onTarget / targetedDays) * 100) : null,
    targetTotals: hasTargets ? targetTotals : null,
    consumedOnTargetedDays: hasTargets ? consumedOnTargetedDays : null,
    calorieAdherencePct:
      hasTargets && targetTotals.calories > 0
        ? Math.round((consumedOnTargetedDays.calories / targetTotals.calories) * 1000) / 10
        : null,
    periodVerdict,
    perJudgedDay:
      judgedDays > 0
        ? { consumed: perDay(consumedOnTargetedDays, judgedDays), target: perDay(targetOnJudgedDays, judgedDays) }
        : null,
    intakePerLoggedDay: loggedDays > 0 ? perDay(intake, loggedDays) : null,
    netCaloriesOnJudgedDays: judgedDays > 0 ? net : null,
  };
}
