import type { DietType, NutritionEvent } from "@/types/check-in";
import type { DayOfWeek } from "@/utils/nutrition-helpers";
import { DAY_NAMES } from "@/lib/date-helpers";
import { calculateDailyMacros } from "@/utils/nutrition-helpers";

/**
 * The one answer to "what is this client's nutrition target on this date?"
 *
 * A nutrition day is COMPUTED, never stored (owner decision 2026-09-10). It is
 * built from four facts and nothing else: the version covering the date and
 * its grid row for the weekday, the sessions placed on the date, and the
 * coach's per-day edit. Every reader — the coach calendar, the client's day,
 * the check-in week, the history table, the block facts — gets its numbers
 * from this function, so they cannot disagree, and no writer keeps a day in
 * sync with anything.
 *
 * PURE. This module imports no database client: the generator that still
 * writes the retired day table calls it too, which is what makes the two paths
 * agree by construction rather than by a second oracle.
 *
 * The rules, in the order they decide a day:
 *   - an EDITED day takes the coach's calories and macros verbatim, carries
 *     their note, and takes no training surplus — the coach's number is the
 *     whole answer for that date;
 *   - otherwise the baseline is the grid row's calories (custom macros and the
 *     coach's split live there) else the version's baseline;
 *   - the surplus adds every session's percentage — a day holding a morning
 *     run and an evening lift takes both; the burn is that share of the
 *     baseline, else, when no session carries a percentage, the legacy flat sum
 *     of the sessions' estimated calories (a plan placed before the percentage
 *     model);
 *   - the macros are the grid row's, verbatim, else the diet split over the
 *     baseline with protein held at the version's target;
 *   - the coach note is the covering version's save note, carried on the day
 *     the version took effect (the reader decides the day; this carries it).
 *
 * The DTO shape is `NutritionEvent`, the day-row shape every consumer already
 * reads: `id` is the date (unique per client, and the edit routes address
 * days by date), `status` is always `scheduled`.
 */

/** The version covering the date: the plan-level prescription the day derives from. */
type NutritionDayVersion = {
  id: string;
  baselineCalories: number;
  proteinTargetG: number;
  dietType: string;
};

/** The version's grid row for the date's weekday — the coach's numbers, verbatim. */
export type NutritionDayGridRow = {
  calories: number;
  proteinG: number;
  carbG: number;
  fatG: number;
};

/** What the day reads off a session placed on it. */
type NutritionDaySession = {
  calorieSurplusPercentage: number | null;
  estimatedCalories: number | null;
};

/** The coach's override for the date, when one exists. */
type NutritionDayEditInput = {
  calories: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  note: string | null;
};

type NutritionDayInputs = {
  clientId: string;
  date: string;
  version: NutritionDayVersion;
  gridRow: NutritionDayGridRow | null;
  trainingEvents: readonly NutritionDaySession[];
  edit: NutritionDayEditInput | null;
  coachNote: string | null;
};

/**
 * The weekday a date falls on, spelled the way the grid keys it. A
 * local-midnight parse read back through `getDay()` — the same expression the
 * day-table generator used, so the two agree on every host (the test suite pins
 * TZ=UTC). Exported so a caller picking the grid row derives the weekday HERE,
 * never with a second spelling of its own.
 */
export function nutritionDayOfWeek(date: string): DayOfWeek {
  return DAY_NAMES[new Date(date + "T00:00:00").getDay()];
}

/**
 * The day's training surplus: every session's percentage added, null when no
 * session on the day carries one. Shared with the client's weekly targets
 * (`utils/build-daily-targets.ts`), so a day prices the same on every screen.
 */
export function sumSurplusPercentages(
  sessions: readonly { calorieSurplusPercentage: number | null }[],
): number | null {
  const percentages = sessions
    .map((session) => session.calorieSurplusPercentage)
    .filter((percentage): percentage is number => percentage != null);
  return percentages.length === 0 ? null : percentages.reduce((sum, p) => sum + p, 0);
}

export function resolveNutritionDay(input: NutritionDayInputs): NutritionEvent {
  const { clientId, date, version, gridRow, trainingEvents, edit, coachNote } = input;
  const dayOfWeek = nutritionDayOfWeek(date);
  // Live: the sessions on the date decide, whether or not the day is edited —
  // the TRAIN badge follows the calendar, never a stored flag.
  const isTrainingDay = trainingEvents.length > 0;

  if (edit) {
    return {
      id: date,
      clientId,
      nutritionPlanId: version.id,
      date,
      dayOfWeek,
      baselineCalories: edit.calories,
      // Frozen: the coach's number stands, so no surplus stacks on it.
      trainingBurnCalories: 0,
      proteinG: edit.proteinG,
      carbG: edit.carbG,
      fatG: edit.fatG,
      dietType: version.dietType,
      isTrainingDay,
      calorieSurplusPercentage: null,
      isModified: true,
      note: edit.note,
      coachNote,
      status: "scheduled",
    };
  }

  const baselineCalories = gridRow?.calories ?? version.baselineCalories;

  // Percentage model: every session's surplus added, as a share of the baseline.
  // Legacy fallback, when no session carries one: the flat sum of the sessions'
  // estimated calories.
  const surplusPercentage = sumSurplusPercentages(trainingEvents);
  const trainingBurnCalories =
    surplusPercentage != null
      ? Math.round(baselineCalories * surplusPercentage / 100)
      : trainingEvents.reduce((sum, session) => sum + (session.estimatedCalories ?? 0), 0);

  // The grid row carries custom macros and the coach's split — verbatim, never
  // re-derived. Only a version with no row for the weekday splits by diet type.
  const macros = gridRow
    ? { proteinG: gridRow.proteinG, carbsG: gridRow.carbG, fatG: gridRow.fatG }
    : calculateDailyMacros(
        baselineCalories,
        version.proteinTargetG,
        isTrainingDay,
        version.dietType as DietType
      );

  return {
    id: date,
    clientId,
    nutritionPlanId: version.id,
    date,
    dayOfWeek,
    baselineCalories,
    trainingBurnCalories,
    proteinG: macros.proteinG,
    carbG: macros.carbsG,
    fatG: macros.fatG,
    dietType: version.dietType,
    isTrainingDay,
    calorieSurplusPercentage: surplusPercentage,
    isModified: false,
    note: null,
    coachNote,
    status: "scheduled",
  };
}
