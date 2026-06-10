import type { DailyLog } from "@/types/daily-log"
import type { DailyHabit, DailyHabitLog } from "@/types/daily-habit"
import type { TriggerResult } from "./attention-triggers"
import type { TrainingEventRow } from "./attention-feed-helpers"
import {
  NO_ENGAGEMENT_SILENCE_DAYS,
  NO_ENGAGEMENT_ACTIVATION_GRACE_DAYS,
} from "@/lib/constants"
import { getDateString, addDays } from "@/lib/date-helpers"

interface NoEngagementParams {
  logs: DailyLog[]
  habits: DailyHabit[]
  habitLogs: DailyHabitLog[]
  trainingEvents: TrainingEventRow[]
  startDate: string | null
  now?: Date
}

/**
 * Flags an active client who has prescribed work (training events or habits) but
 * has shown NO activity across any logging surface in the recent window.
 *
 * The other eight triggers are pattern detectors over existing logs, so a client
 * who never logs is invisible to them. This is the one *absence* signal — it
 * exists because training-session and habit logging never create daily_logs spine
 * rows, so a fully-disengaged client can have zero `daily_logs_full` rows yet still
 * be missing prescribed work.
 *
 * Activity is checked across all three surfaces because no single one is complete:
 * daily_logs (nutrition/wellness), daily_habit_logs, and completed/partial
 * training_events. A scheduled/missed/skipped event is the ABSENCE of engagement,
 * so it is never counted as activity.
 */
export function evaluateNoEngagement({
  logs,
  habits,
  habitLogs,
  trainingEvents,
  startDate,
  now = new Date(),
}: NoEngagementParams): TriggerResult | null {
  // Nothing prescribed → nothing to be disengaged from. A client still being set
  // up belongs to the activation banner, not the attention feed.
  if (trainingEvents.length === 0 && habits.length === 0) return null

  // Activation grace: don't flag a freshly-activated client before they've had a
  // few days to start. Fires only once start_date + grace has elapsed.
  if (!startDate) return null
  const startDay = startDate.slice(0, 10)
  const graceCutoff = getDateString(addDays(now, -NO_ENGAGEMENT_ACTIVATION_GRACE_DAYS))
  if (graceCutoff < startDay) return null

  // Any activity within the silence window ("last N days" ending on the
  // feed's coach-local window end, threaded in as `now`) across ANY surface
  // clears the alert.
  const cutoff = getDateString(addDays(now, -NO_ENGAGEMENT_SILENCE_DAYS))
  const hasActivity =
    logs.some((log) => log.date >= cutoff) ||
    habitLogs.some((log) => log.date >= cutoff) ||
    trainingEvents.some(
      (e) => (e.status === "completed" || e.status === "partial") && e.date >= cutoff
    )
  if (hasActivity) return null

  // affectedDays = [today] so a dismissal (stored as a DATE) lasts the day and the
  // alert resurfaces tomorrow if the client is still silent (see filterDismissedAlerts).
  return {
    type: "no_engagement",
    severity: "medium",
    message: `No activity logged in the last ${NO_ENGAGEMENT_SILENCE_DAYS} days`,
    affectedDays: [getDateString(now)],
    metricData: [],
  }
}
