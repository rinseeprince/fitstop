import { supabaseAdmin } from "./supabase-admin";
import { getActiveTrainingPlan } from "./training-service";
import { getNutritionPlanForDate } from "./nutrition-plan-service";
import { getEventsForDateRange } from "./training-event-service";
import { getNutritionEventsForDateRange } from "./nutrition-days-service";
import { mapNutritionEventToDisplayTarget } from "@/utils/nutrition-event-helpers";
import { getTrainingWeekStart, getTrainingWeekEnd } from "@/lib/date-helpers";
import { getClientTodayString } from "./today-service";
import { getClientWeekAnchor } from "./check-in-week-service";
import type {
  CheckInTrainingContext,
  CheckInNutritionContext,
  CheckInTrainingEventDetail,
  DayOfWeek,
} from "@/types/check-in";
import { sessionExercises } from "@/utils/exercise-groups";

/**
 * Get training context for the check-in form
 * Returns the active training plan's sessions and exercises
 */
export const getCheckInTrainingContext = async (
  clientId: string
): Promise<CheckInTrainingContext> => {
  const plan = await getActiveTrainingPlan(clientId);

  if (!plan) {
    return { hasActivePlan: false, sessions: [] };
  }

  const trainingSessions = plan.sessions;

  return {
    hasActivePlan: true,
    planId: plan.id,
    planName: plan.name,
    sessions: trainingSessions.map((s) => ({
      id: s.id,
      name: s.name,
      dayOfWeek: s.dayOfWeek as DayOfWeek | undefined,
      focus: s.focus,
      exercises: sessionExercises(s).map((e) => ({
        id: e.id,
        name: e.name,
        sets: e.sets,
        repsTarget: e.repsTarget || (e.repsMin && e.repsMax
          ? `${e.repsMin}-${e.repsMax}`
          : e.repsMin?.toString()),
      })),
    })),
  };
};

/**
 * Get nutrition context for the check-in form
 * Returns the client's nutrition targets for display
 */
export const getCheckInNutritionContext = async (
  clientId: string
): Promise<CheckInNutritionContext> => {
  // Client-local today: the check-in form's "current week" targets must agree
  // with the gate/period (also client-local) — at 00:30 local just past a UTC
  // week rollover, server-UTC today would show last week's targets. The week
  // ANCHOR is fetched alongside for the same reason: this window used to be
  // hard-Mon-Sun for every client, so a Wednesday client's "current week"
  // targets covered a different seven days from the period they were about to
  // report on.
  const [today, { weekday: checkInDay }] = await Promise.all([
    getClientTodayString(clientId),
    getClientWeekAnchor(clientId),
  ]);

  // Versioned model (migration 144): the gate is COVERING-existence — is a
  // version governing the client's today? The row is used only as this gate
  // (real targets come from the week's events below), and a queued-only chain
  // correctly reads as "no targets this week yet".
  const nutritionPlan = await getNutritionPlanForDate(clientId, today).catch((err) => {
    console.error("Check-in nutrition context plan lookup failed:", err);
    return null;
  });

  if (!nutritionPlan || !nutritionPlan.baseline_calories) {
    return { hasNutritionPlan: false };
  }

  // Try event-based targets for the current week
  const weekStart = getTrainingWeekStart(today, checkInDay);
  const weekEnd = getTrainingWeekEnd(today, checkInDay);

  const events = await getNutritionEventsForDateRange(clientId, weekStart, weekEnd);

  // Use event-based targets (all available events for the week), each priced
  // with its own version's two surplus settings (migration 196).
  const weeklyTargets: Array<{ day: DayOfWeek; dayLabel: string; isTrainingDay: boolean; calories: number; proteinG: number; carbsG: number; fatG: number }> = events.slice(0, 7).map((event) => {
    const display = mapNutritionEventToDisplayTarget(event);
    return {
      day: display.day as DayOfWeek,
      dayLabel: display.dayLabel,
      isTrainingDay: display.isTrainingDay,
      calories: display.calories,
      proteinG: display.proteinG,
      carbsG: display.carbsG,
      fatG: display.fatG,
    };
  });

  const count = weeklyTargets.length || 1;
  const avgCalories = Math.round(weeklyTargets.reduce((sum, d) => sum + d.calories, 0) / count);
  const avgProteinG = Math.round(weeklyTargets.reduce((sum, d) => sum + d.proteinG, 0) / count);
  const avgCarbsG = Math.round(weeklyTargets.reduce((sum, d) => sum + d.carbsG, 0) / count);
  const avgFatG = Math.round(weeklyTargets.reduce((sum, d) => sum + d.fatG, 0) / count);

  return {
    hasNutritionPlan: true,
    weeklyTargets,
    averageTargets: {
      calories: avgCalories,
      proteinG: avgProteinG,
      carbsG: avgCarbsG,
      fatG: avgFatG,
    },
  };
};

/**
 * Single-source per-workout training detail for the check-in period
 * (Session 6.2). Every check-in surface that shows or counts the period's
 * training reads THIS — the wizard's rows and stats, and both single check-in
 * reads.
 *
 * `training_events` says whether each workout was logged; its own log, embedded
 * on the range read through the named foreign key, says how it went. The
 * quality is therefore always on the row — null when the client has not logged
 * it — and no reader derives it from the status word.
 *
 * Two queries regardless of workout count: one range read of the events with
 * their logs, and (only when at least one swap is detected) one batched read of
 * the performed `training_sessions`' names.
 */
export async function getTrainingEventDetailsForPeriod(
  clientId: string,
  periodStart: string,
  periodEnd: string
): Promise<CheckInTrainingEventDetail[]> {
  const events = await getEventsForDateRange(clientId, periodStart, periodEnd);
  if (events.length === 0) return [];

  // Swap detection: a logged session whose PERFORMED session differs from the
  // event's PRESCRIBED session. Batch-resolve the performed session names.
  const performedSessionIdOf = (event: (typeof events)[number]): string | null => {
    const performedId = event.log?.performedSessionId ?? null;
    if (!performedId || !event.trainingSessionId) return null;
    return performedId === event.trainingSessionId ? null : performedId;
  };

  const performedNameBySessionId = new Map<string, string>();
  const swappedPerformedIds = new Set<string>();
  for (const e of events) {
    const performedId = performedSessionIdOf(e);
    if (performedId) swappedPerformedIds.add(performedId);
  }
  if (swappedPerformedIds.size > 0) {
    // supabaseAdmin: client portal reading own training_sessions (RLS exception 3)
    const { data, error } = await supabaseAdmin
      .from("training_sessions")
      .select("id, name")
      .in("id", Array.from(swappedPerformedIds));
    if (error) {
      console.error("Error fetching performed session names for check-in detail:", error.message);
    }
    for (const row of data ?? []) {
      performedNameBySessionId.set(row.id, row.name);
    }
  }

  // Events are already in calendar order — by date, a day's sessions in the
  // day's order (getEventsForDateRange) — so a day holding several lists each.
  return events.map((e) => {
    const detail: CheckInTrainingEventDetail = {
      eventId: e.id,
      date: e.date,
      sessionName: e.sessionName,
      status: e.status,
      logStatus: e.sessionLogId ? "logged" : "not_logged",
      // Always set, so the row itself is a `TrainingWorkoutRead`: null is "the
      // client has not logged this", and every reader — the wizard's rows, the
      // review's pills and `summariseTraining` — reads how the
      // workout went from here rather than from `status`.
      completionQuality: e.log?.completionQuality ?? null,
      trainingSessionId: e.trainingSessionId,
      sessionLogId: e.sessionLogId,
    };
    if (e.log?.notes) detail.notes = e.log.notes;
    const performedId = performedSessionIdOf(e);
    if (performedId) {
      detail.performedSessionName = performedNameBySessionId.get(performedId) ?? null;
    }
    return detail;
  });
}
