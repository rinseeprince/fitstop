import { getEventsForDateRange } from "./training-event-service";
import { getCoachTodayString } from "./today-service";
import { getClientWeekAnchor } from "./check-in-week-service";
import { getTrainingWeekStart, getTrainingWeekEnd } from "@/lib/date-helpers";
import { eventWorkoutRead } from "@/lib/training-display-state";
import { summariseTraining } from "@/lib/training-adherence";
import type { TrainingWeekSummary } from "@/types/history";

/**
 * The coach's current-week training summary, shared by the Training tab's hero
 * (`/history/training/summary`) and the Overview's plan card
 * (`overview-plan-summary-service`). Both consume this; do not fork the
 * calculation.
 *
 * **It counts CALENDAR WORKOUTS, by their date.** A workout is on the week its
 * event is dated to, and how it went is read off that workout's own log through
 * the one summariser (`lib/training-adherence.ts`). The count used to come from
 * `session_logs.completed_at`, which does not move when a workout moves — a
 * workout dragged to the 27th kept a log stamped the 26th and was counted in
 * the wrong week. No adherence figure reads `completed_at` now.
 *
 * Semantics (unchanged): coach-local "current week" anchored on the client's
 * check-in day; `completed` counts FULL workouts only; `planned` counts the
 * week's workouts up to today (you cannot miss a future session).
 */
export type TrainingWeekSummaryWithWindow = TrainingWeekSummary & {
  weekStart: string;
  weekEnd: string;
};

export const getTrainingWeekSummary = async (
  clientId: string,
  coachId: string
): Promise<TrainingWeekSummaryWithWindow> => {
  // Coach-local "current week": this is the coach's summary view.
  const [{ weekday: checkInDay }, today] = await Promise.all([
    getClientWeekAnchor(clientId),
    getCoachTodayString(coachId),
  ]);
  const weekStart = getTrainingWeekStart(today, checkInDay);
  const weekEnd = getTrainingWeekEnd(today, checkInDay);

  // Capped at today — a session still to be done later in the week is neither
  // planned-against nor missed yet. The week is the one CONTAINING today, so
  // the cap is always inside it.
  const effectiveEnd = today < weekEnd ? today : weekEnd;
  const events = await getEventsForDateRange(clientId, weekStart, effectiveEnd);

  const summary = summariseTraining(events.map(eventWorkoutRead));

  // FULL completions only, as this hero has always read. Partials join the
  // numerator in commit 10, where every done-count changes together.
  const completed = summary.full;
  const plannedUpToToday = summary.planned;

  return {
    completed,
    totalPlanned: plannedUpToToday,
    plannedUpToToday,
    missed: Math.max(0, plannedUpToToday - completed),
    weekStart,
    weekEnd,
  };
};
