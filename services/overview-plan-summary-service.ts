import { supabaseAdmin } from "./supabase-admin";
import { coversDate } from "./training-plan-window";
import { getNextFutureTrainingPlan, getTrainingPlanForDate } from "./training-service";
import {
  getTrainingWeekSummary,
  type TrainingWeekSummaryWithWindow,
} from "./training-week-summary-service";
import { getClientTodayString } from "./today-service";
import { getNutritionForDate } from "./daily-context-service";
import {
  getClientExerciseList,
  getExerciseProgressionSeries,
} from "./exercise-analytics-service";
import { planWeek } from "@/utils/plan-week";
import { differenceInDays } from "@/lib/date-helpers";
import type { TrainingPlan } from "@/types/training";
import type { OverviewPlanSummary } from "@/types/coach-overview";

/**
 * Date-resolved plan metadata for the Overview's CURRENT PLAN cards.
 * Delegates everything already built elsewhere: plan resolution
 * (getTrainingPlanForDate — coach-side, by date), this-week math
 * (training-week-summary-service, the /history/training/summary math),
 * nutrition day targets (getNutritionForDate — log-snapshot-first), and the
 * progression RPC path (exercise-analytics-service).
 */

/**
 * Modal (most frequent) surplus among a week's training events; ties break to
 * the larger value so the result is deterministic. Null when no event carries
 * a surplus (rest week or surplus-less sessions).
 */
export function modalSurplus(
  events: { calorie_surplus_percentage: number | null }[]
): number | null {
  const counts = new Map<number, number>();
  for (const event of events) {
    if (event.calorie_surplus_percentage == null) continue;
    const value = Number(event.calorie_surplus_percentage);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && (best === null || value > best))) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

type ExerciseE1RMSeries = {
  points: { date: string; estimatedOneRepMax: number | null }[];
};

/**
 * Locked decision 6: mean % change in best e1RM per exercise — current week vs
 * the block's first logged week, averaged over exercises present in both
 * (warm-ups already excluded by the analytics service). Weeks are plan weeks
 * (7-day buckets from effective_from, the date-walk convention). Null whenever
 * the comparison is undefined: no points, first logged week IS the current
 * week, or no exercise appears in both weeks.
 */
export function progressionFromSeries(
  series: ExerciseE1RMSeries[],
  effectiveFrom: string,
  currentWeek: number
): number | null {
  const perExercise: Map<number, number>[] = series.map((exercise) => {
    const bestByWeek = new Map<number, number>();
    for (const point of exercise.points) {
      if (point.estimatedOneRepMax == null) continue;
      const elapsed = differenceInDays(
        new Date(point.date.slice(0, 10) + "T00:00:00"),
        new Date(effectiveFrom + "T00:00:00")
      );
      if (elapsed < 0) continue;
      const week = Math.floor(elapsed / 7) + 1;
      const best = bestByWeek.get(week);
      if (best === undefined || point.estimatedOneRepMax > best) {
        bestByWeek.set(week, point.estimatedOneRepMax);
      }
    }
    return bestByWeek;
  });

  let firstLoggedWeek: number | null = null;
  for (const bestByWeek of perExercise) {
    for (const week of bestByWeek.keys()) {
      if (firstLoggedWeek === null || week < firstLoggedWeek) firstLoggedWeek = week;
    }
  }
  if (firstLoggedWeek === null || firstLoggedWeek >= currentWeek) return null;

  const changes: number[] = [];
  for (const bestByWeek of perExercise) {
    const firstBest = bestByWeek.get(firstLoggedWeek);
    const currentBest = bestByWeek.get(currentWeek);
    if (firstBest === undefined || currentBest === undefined || firstBest <= 0) continue;
    changes.push((currentBest / firstBest - 1) * 100);
  }
  if (!changes.length) return null;

  const mean = changes.reduce((sum, value) => sum + value, 0) / changes.length;
  return Math.round(mean * 10) / 10;
}

async function computeProgressionPct(
  clientId: string,
  plan: TrainingPlan,
  clientToday: string
): Promise<number | null> {
  if (!plan.effectiveFrom) return null;
  const currentWeek = planWeek(plan.effectiveFrom, clientToday, plan.programDurationWeeks ?? null);
  if (currentWeek === null) return null;

  const exercises = await getClientExerciseList(clientId, {
    startDate: plan.effectiveFrom,
    endDate: clientToday,
  });
  if (!exercises.length) return null;

  const series = await Promise.all(
    exercises.map(async (exercise) => ({
      points: await getExerciseProgressionSeries(clientId, {
        ...(exercise.exerciseId
          ? { exerciseId: exercise.exerciseId }
          : { exerciseName: exercise.name }),
        startDate: plan.effectiveFrom,
        endDate: clientToday,
      }),
    }))
  );

  return progressionFromSeries(series, plan.effectiveFrom, currentWeek);
}

async function getNextSession(
  clientId: string,
  clientToday: string
): Promise<{ name: string; date: string; isToday: boolean } | null> {
  // Upcoming, still scheduled, unlinked.
  const { data, error } = await supabaseAdmin
    .from("training_events")
    .select("session_name, date")
    .eq("client_id", clientId)
    .gte("date", clientToday)
    .eq("status", "scheduled")
    .is("session_log_id", null)
    .order("date", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Failed to read next session:", error);
    return null;
  }
  if (!data) return null;
  return { name: data.session_name, date: data.date, isToday: data.date === clientToday };
}

async function buildTrainingSummary(
  clientId: string,
  clientToday: string,
  week: TrainingWeekSummaryWithWindow
): Promise<OverviewPlanSummary["training"]> {
  const plan = await getTrainingPlanForDate(clientId, clientToday);
  if (!plan) return null;

  const [nextSession, progressionPct] = await Promise.all([
    getNextSession(clientId, clientToday),
    computeProgressionPct(clientId, plan, clientToday),
  ]);

  return {
    planId: plan.id,
    planName: plan.name,
    splitType: plan.splitType ?? null,
    frequencyPerWeek: plan.frequencyPerWeek ?? null,
    programDurationWeeks: plan.programDurationWeeks ?? null,
    currentWeek: plan.effectiveFrom
      ? planWeek(plan.effectiveFrom, clientToday, plan.programDurationWeeks ?? null)
      : null,
    thisWeek: {
      completed: week.completed,
      planned: week.plannedUpToToday,
      missed: week.missed,
    },
    nextSession,
    progressionPct,
  };
}

/**
 * The soonest program whose window has not opened yet.
 *
 * Reads through the shared `getNextFutureTrainingPlan` predicate rather than a
 * local copy — this card and the Training tab must never disagree about whether
 * a client has a program queued.
 */
async function buildUpcomingTraining(
  clientId: string,
  clientToday: string
): Promise<OverviewPlanSummary["upcomingTraining"]> {
  const next = await getNextFutureTrainingPlan(clientId, clientToday);
  if (!next) return null;

  return {
    planId: next.id,
    planName: next.name,
    startsOn: next.effectiveFrom,
    splitType: next.splitType,
    frequencyPerWeek: next.frequencyPerWeek,
    programDurationWeeks: next.programDurationWeeks,
  };
}

async function buildNutritionSummary(
  clientId: string,
  clientToday: string,
  weekStart: string,
  weekEnd: string
): Promise<OverviewPlanSummary["nutrition"]> {
  // The version COVERING the client's today (migration 144) — the Overview
  // card describes what the client is on NOW, so a queued future version must
  // not surface here and a superseded era must not linger.
  const { data: plan, error } = await coversDate(
    supabaseAdmin
      .from("nutrition_plans")
      .select(
        // Carbs and fat came off with the Overview card's macro row — four
        // columns that fed nothing else. Protein stays: the activation banner
        // renders it beside the rest-day calories.
        "diet_type, baseline_calories, protein_target_g, protein_target_g_per_kg, custom_macros_enabled, custom_calories, custom_protein_g"
      )
      .eq("client_id", clientId)
      .eq("status", "active"),
    clientToday
  )
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Failed to read active nutrition plan:", error);
    throw new Error("Failed to read nutrition plan");
  }
  if (!plan) return null;

  const customMacros = plan.custom_macros_enabled;
  // The custom-macros override is the effective prescription when enabled —
  // same precedence as the contract's macros rule, applied to calories too.
  const restDayCalories =
    customMacros && plan.custom_calories != null ? plan.custom_calories : plan.baseline_calories;

  // Same check-in-anchored week as the training card, so the two cards agree.
  const { data: weekEvents, error: eventsError } = await supabaseAdmin
    .from("training_events")
    .select("date, calorie_surplus_percentage")
    .eq("client_id", clientId)
    .gte("date", weekStart)
    .lte("date", weekEnd);

  if (eventsError) {
    console.error("Failed to read this week's training events:", eventsError);
    throw new Error("Failed to read training events");
  }

  const events = weekEvents ?? [];
  const trainingDates = new Set(events.map((event) => event.date));
  const surplusPct = modalSurplus(events);
  const trainDayCalories =
    surplusPct != null ? Math.round(restDayCalories * (1 + surplusPct / 100)) : null;

  const day = await getNutritionForDate(clientId, clientToday);
  const today = day.target
    ? {
        targetCalories: day.target.calories,
        loggedCalories: day.consumed?.calories ?? null,
      }
    : null;

  return {
    dietType: plan.diet_type ?? null,
    customMacros,
    proteinGPerKg: plan.protein_target_g_per_kg ?? null,
    restDayCalories,
    trainDayCalories,
    surplusPct,
    restDaysThisWeek: 7 - trainingDates.size,
    today,
    // Falls back from the nullable custom override to the non-null baseline
    // column, so the banner's line is guaranteed a number.
    proteinTargetG: (customMacros ? plan.custom_protein_g : null) ?? plan.protein_target_g,
  };
}

export const getOverviewPlanSummary = async (
  coachId: string,
  clientId: string
): Promise<OverviewPlanSummary> => {
  const clientToday = await getClientTodayString(clientId);
  // One week-window computation feeds both cards (and the training thisWeek
  // numbers) so they can never disagree.
  const week = await getTrainingWeekSummary(clientId, coachId);

  const [training, upcomingTraining, nutrition] = await Promise.all([
    buildTrainingSummary(clientId, clientToday, week),
    buildUpcomingTraining(clientId, clientToday),
    buildNutritionSummary(clientId, clientToday, week.weekStart, week.weekEnd),
  ]);

  return { training, upcomingTraining, nutrition };
};
