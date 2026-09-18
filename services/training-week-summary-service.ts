import { getEventsForDateRange } from "./training-event-service";
import { getCoachTodayString } from "./today-service";
import { getClientWeekAnchor } from "./check-in-week-service";
import { getTrainingWeekStart, getTrainingWeekEnd } from "@/lib/date-helpers";
import { eventWorkoutRead, loggedDisplayQuality } from "@/lib/training-display-state";
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
 * Semantics: coach-local "current week" anchored on the client's check-in day;
 * `completed` counts every workout the client LOGGED, full or partial;
 * `planned` counts the week's workouts up to today **plus today's only once
 * they are logged** (you cannot miss a session the day has not finished with),
 * so `missed` is the rest of them and the three figures always add up.
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

  // TODAY's workouts count only once the client has LOGGED them. The cap above
  // is inclusive, so without this a session the client can still do this
  // afternoon sits in `planned` and in `missed` — and the Overview's rail,
  // which derives missed from the day (`trainingDisplayState`), calls the same
  // session "no log" two inches away. The summariser is deliberately date-free,
  // so the day rule is applied here, where the window's own cap lives.
  const counted = events.filter(
    (event) =>
      event.date.slice(0, 10) !== today ||
      loggedDisplayQuality(eventWorkoutRead(event)) !== null
  );

  // Every figure here comes out of the one summariser, so the hero and the
  // Overview's plan card cannot spell a count differently: `missed` is what is
  // left of `planned` once the logged workouts are taken off it.
  const summary = summariseTraining(counted.map(eventWorkoutRead));

  return {
    completed: summary.completed,
    totalPlanned: summary.planned,
    plannedUpToToday: summary.planned,
    missed: summary.missed,
    weekStart,
    weekEnd,
  };
};
