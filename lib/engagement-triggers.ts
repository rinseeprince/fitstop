import type { DailyHabit } from "@/types/daily-habit"
import type { TriggerResult } from "./attention-triggers"
import type { TrainingEventRow } from "./attention-feed-helpers"
import {
  NO_ENGAGEMENT_SILENCE_DAYS,
  NO_ENGAGEMENT_ACTIVATION_GRACE_DAYS,
} from "@/lib/constants"
import { getDateString, addDays } from "@/lib/date-helpers"

interface NoEngagementParams {
  /**
   * The client's logged days in the feed's window — the derived definition,
   * `loggedDays` in `lib/logged-days.ts`, assembled by the caller from the
   * rows it holds. Any log the client made themselves counts.
   */
  loggedDays: readonly string[]
  habits: DailyHabit[]
  trainingEvents: TrainingEventRow[]
  startDate: string | null
  now?: Date
}

/**
 * Flags an active client who has prescribed work (training events or habits) but
 * no logged day in the recent window.
 *
 * The other triggers are pattern detectors over existing logs, so a client who
 * never logs is invisible to them. This is the one *absence* signal. It reads the
 * one definition of a logged day, so a client who only trains, or only ticks
 * habits, is never read as silent.
 */
export function evaluateNoEngagement({
  loggedDays,
  habits,
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

  // Any logged day within the silence window ("last N days" ending on the
  // feed's coach-local window end, threaded in as `now`) clears the alert.
  const cutoff = getDateString(addDays(now, -NO_ENGAGEMENT_SILENCE_DAYS))
  if (loggedDays.some((day) => day >= cutoff)) return null

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
