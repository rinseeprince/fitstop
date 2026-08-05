import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";
import { DAYS_OF_WEEK, calculateDailyMacros, applySurplusSplit } from "@/utils/nutrition-helpers";
import { getTrainingSessionsSummary } from "@/utils/training-calorie-helpers";
import { mapNutritionEventToDisplayTarget } from "@/utils/nutrition-event-helpers";
import type { TrainingPlan, TrainingEvent } from "@/types/training";
import type { DietType, NutritionEvent } from "@/types/check-in";

const DAY_NAMES: Record<number, string> = {
  0: "sunday", 1: "monday", 2: "tuesday", 3: "wednesday",
  4: "thursday", 5: "friday", 6: "saturday",
};

/** Get surplus percentage from events for a specific day-of-week. Uses the first event's value. */
function getEventSurplusByDay(events: TrainingEvent[]): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  for (const event of events) {
    const dayOfWeek = DAY_NAMES[new Date(event.date + "T00:00:00").getDay()];
    if (!(dayOfWeek in result)) {
      result[dayOfWeek] = event.calorieSurplusPercentage ?? null;
    }
  }
  return result;
}

/** Build training session summaries from events, grouped by day-of-week. */
function getEventSessionsSummary(events: TrainingEvent[], day: string): Array<{ name: string; calories: number }> {
  return events
    .filter((e) => DAY_NAMES[new Date(e.date + "T00:00:00").getDay()] === day)
    .map((e) => ({ name: e.sessionName, calories: e.estimatedCalories || 0 }));
}

type StoredDailyTarget = {
  day_of_week: string;
  calories: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
  is_training_day: boolean;
};

type PlanBaseline = {
  baseline_calories: number;
  protein_target_g: number;
  carb_target_g: number;
  fat_target_g: number;
};

/**
 * Build DailyNutritionTargets[] from stored plan data + live training events,
 * and (for the client program view) the week's dense nutrition events.
 *
 * Shared between the coach nutrition API route (stat-band + weekly-total
 * targets — pass no `nutritionEvents` → weekday template) and the client portal
 * service (pass the current week's events → date-accurate, shows per-day edits
 * + notes).
 *
 * The surplus-split policy is unified with the coach calendar:
 *   - event-present days reuse `mapNutritionEventToDisplayTarget` (parity by
 *     construction — frozen `is_modified` days display verbatim, the
 *     `surplusAsCarbs` toggle decides the split), overriding only the live
 *     trainingSessions list + the coach note;
 *   - no-event (template) days hold protein and split any training surplus via
 *     `applySurplusSplit`, preserving the coach's stored carb/fat ratio (never
 *     re-derived from the diet type), with stored macros shown verbatim on rest
 *     days / when burn is off.
 */
export function buildDailyTargetsFromPlan(
  plan: PlanBaseline,
  dailyTargetRows: StoredDailyTarget[] | null,
  trainingPlan: TrainingPlan | null,
  includeActivityBurn: boolean,
  dietType: DietType,
  surplusAsCarbs: boolean,
  trainingEvents?: TrainingEvent[],
  nutritionEvents?: NutritionEvent[]
): DailyNutritionTargets[] {
  const surplusByDay = trainingEvents ? getEventSurplusByDay(trainingEvents) : {};

  const targetsByDay = new Map(
    (dailyTargetRows || []).map((dt) => [dt.day_of_week, dt])
  );

  // First-wins weekday -> nutrition event map. One event per weekday in a
  // Mon-Sun window; the guard tolerates a future widening of the range.
  const eventsByWeekday = new Map<string, NutritionEvent>();
  for (const ev of nutritionEvents ?? []) {
    if (!eventsByWeekday.has(ev.dayOfWeek)) eventsByWeekday.set(ev.dayOfWeek, ev);
  }

  const trainingSessionsFor = (day: string) =>
    trainingEvents
      ? getEventSessionsSummary(trainingEvents, day)
      : getTrainingSessionsSummary(trainingPlan, day);

  return DAYS_OF_WEEK.map((day) => {
    const dayLabel = day.charAt(0).toUpperCase() + day.slice(1);

    // Event-present day -> reuse the calendar mapper for full parity, then
    // layer the live training-session list (the mapper returns none). The
    // mapper already honors includeActivityBurn, is_modified, and surplusAsCarbs.
    const event = eventsByWeekday.get(day);
    if (event) {
      return {
        ...mapNutritionEventToDisplayTarget(event, includeActivityBurn, surplusAsCarbs),
        trainingSessions: trainingSessionsFor(day),
        note: event.note ?? null,
      };
    }

    // No-event (template) day.
    const stored = targetsByDay.get(day);
    const baselineCalories = stored?.calories ?? plan.baseline_calories;
    const proteinG = stored?.protein_g ?? plan.protein_target_g;

    // Baseline carb/fat ratio: prefer the coach's stored split; derive from the
    // diet type only when no daily-target row exists.
    let baselineCarbG: number;
    let baselineFatG: number;
    if (stored) {
      baselineCarbG = stored.carb_g;
      baselineFatG = stored.fat_g;
    } else {
      const m = calculateDailyMacros(baselineCalories, proteinG, false, dietType);
      baselineCarbG = m.carbsG;
      baselineFatG = m.fatG;
    }

    const daySurplus = surplusByDay[day] ?? null;
    const isTrainingDay = trainingEvents
      ? day in surplusByDay
      : stored?.is_training_day ?? false;

    // Apply the training surplus only when burn is on and a real surplus exists;
    // otherwise the stored macros display verbatim (matches the event mapper's
    // verbatim guard).
    const applyBurn = includeActivityBurn && daySurplus != null && daySurplus > 0;
    let dayCalories: number;
    let trainingSessionCalories: number;
    let carbsG: number;
    let fatG: number;
    if (applyBurn) {
      dayCalories = Math.round(baselineCalories * (1 + daySurplus / 100));
      trainingSessionCalories = dayCalories - baselineCalories;
      ({ carbsG, fatG } = applySurplusSplit(dayCalories, proteinG, baselineCarbG, baselineFatG, surplusAsCarbs));
    } else {
      dayCalories = baselineCalories;
      trainingSessionCalories = 0;
      carbsG = baselineCarbG;
      fatG = baselineFatG;
    }

    const totalCal = proteinG * 4 + carbsG * 4 + fatG * 9;
    const proteinPercent = totalCal > 0 ? Math.round((proteinG * 4 / totalCal) * 100) : 0;
    const carbsPercent = totalCal > 0 ? Math.round((carbsG * 4 / totalCal) * 100) : 0;

    return {
      day,
      dayLabel,
      isTrainingDay,
      calories: dayCalories,
      baselineCalories,
      proteinG,
      carbsG,
      fatG,
      proteinPercent,
      carbsPercent,
      fatPercent: 100 - proteinPercent - carbsPercent,
      trainingSessionCalories,
      trainingSessions: trainingSessionsFor(day),
      totalCaloriesWithActivities: dayCalories,
      includeActivityBurn,
      calorieSurplusPercentage: daySurplus,
    };
  });
}
