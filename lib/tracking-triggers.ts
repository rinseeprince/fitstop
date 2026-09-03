import type { DailyLog } from "@/types/daily-log"
import type { TriggerResult } from "./attention-triggers"
import type { TrainingEventRow } from "./attention-feed-helpers"
import {
  LOGGING_GAP_THRESHOLD_DAYS,
  NUTRITION_MISSED_CONSECUTIVE_DAYS,
  TRAINING_MISSED_WEEKLY_THRESHOLD,
  PARTIAL_TRAINING_LOOKBACK_EVENTS,
  PARTIAL_TRAINING_THRESHOLD,
} from "@/lib/constants"
import { getDateString, getTrainingWeekStart } from "@/lib/date-helpers"

/**
 * Evaluates if there's a gap in daily logging.
 *
 * `loggedDays` is the derived set — `loggedDays` in `lib/logged-days.ts`,
 * assembled by the caller from the rows it holds — so a day the client only
 * trained or only ticked a habit is a logged day here, not a gap.
 */
export function evaluateLoggingGap(
  loggedDays: readonly string[],
  dateRange: { start: string; end: string }
): TriggerResult | null {
  if (loggedDays.length === 0) return null
  const sortedDays = [...loggedDays].sort()
  const missingDays: string[] = []
  // Check for gaps between logged days
  for (let i = 1; i < sortedDays.length; i++) {
    const currentDate = new Date(sortedDays[i] + 'T00:00:00')
    const previousDate = new Date(sortedDays[i - 1] + 'T00:00:00')
    const daysBetween = Math.floor((currentDate.getTime() - previousDate.getTime()) / (1000 * 60 * 60 * 24))
    if (daysBetween > LOGGING_GAP_THRESHOLD_DAYS) {
      // Found a gap
      for (let j = 1; j < daysBetween && j <= LOGGING_GAP_THRESHOLD_DAYS; j++) {
        const missingDate = new Date(previousDate)
        missingDate.setDate(missingDate.getDate() + j)
        missingDays.push(getDateString(missingDate))
      }
      
      return {
        type: "no_log_gap",
        severity: "medium",
        message: `No daily logs for ${missingDays.length} consecutive days`,
        affectedDays: missingDays.slice(0, LOGGING_GAP_THRESHOLD_DAYS),
        metricData: []
      }
    }
  }
  // Check gap from last logged day to end date
  if (sortedDays.length > 1) {
    const endDate = new Date(dateRange.end + 'T00:00:00')
    const mostRecentDate = new Date(sortedDays[sortedDays.length - 1] + 'T00:00:00')
    const daysSinceLastLog = Math.floor((endDate.getTime() - mostRecentDate.getTime()) / (1000 * 60 * 60 * 24))
    if (daysSinceLastLog > LOGGING_GAP_THRESHOLD_DAYS) {
      for (let i = 1; i <= Math.min(daysSinceLastLog, LOGGING_GAP_THRESHOLD_DAYS); i++) {
        const missingDate = new Date(mostRecentDate)
        missingDate.setDate(missingDate.getDate() + i)
        missingDays.push(getDateString(missingDate))
      }
      
      return {
        type: "no_log_gap",
        severity: "medium",
        message: `No daily logs for ${missingDays.length} consecutive days`,
        affectedDays: missingDays.slice(0, LOGGING_GAP_THRESHOLD_DAYS),
        metricData: []
      }
    }
  }
  return null
}

/**
 * Evaluates if nutrition has been missed consecutively
 */
export function evaluateNutritionMisses(logs: DailyLog[]): TriggerResult | null {
  const sortedLogs = [...logs].sort((a, b) => a.date.localeCompare(b.date))
  let consecutiveMissed = 0
  let currentStreakDays: string[] = []
  let lastValidStreak: string[] | null = null
  for (let i = 0; i < sortedLogs.length; i++) {
    if (sortedLogs[i].nutritionAdherence === "missed") {
      consecutiveMissed++
      currentStreakDays.push(sortedLogs[i].date)
      if (consecutiveMissed >= NUTRITION_MISSED_CONSECUTIVE_DAYS) {
        // Check if this streak extends to the most recent logs
        if (i === sortedLogs.length - 1 || i === sortedLogs.length - 2) {
          lastValidStreak = [...currentStreakDays]
        }
      }
    } else {
      consecutiveMissed = 0
      currentStreakDays = []
    }
  }
  // Only return alert if the last valid streak exists (pattern is ongoing/recent)
  if (lastValidStreak && lastValidStreak.length >= NUTRITION_MISSED_CONSECUTIVE_DAYS) {
    // Get last 7 calorie data points for sparkline
    const recentLogs = sortedLogs.slice(-7)
    const metricData = recentLogs
      .filter(log => log.caloriesConsumed !== undefined && log.caloriesConsumed !== null)
      .map(log => ({ date: log.date, value: log.caloriesConsumed! }))
    return {
      type: "nutrition_missed",
      severity: "medium",
      message: `Nutrition targets missed for ${NUTRITION_MISSED_CONSECUTIVE_DAYS}+ consecutive days`,
      affectedDays: lastValidStreak.slice(-NUTRITION_MISSED_CONSECUTIVE_DAYS),
      metricData
    }
  }
  return null
}

/**
 * Evaluates if training sessions have been missed this week.
 * Week boundaries are based on the client's check-in day (defaults to Mon-Sun).
 * Reads from training_events directly — a past event is "missed" if its status
 * is scheduled, missed, or skipped. Partial counts as attended (client showed up).
 * Today's events are excluded — the client may still train later today.
 */
export function evaluateTrainingMisses(
  events: TrainingEventRow[],
  now: Date = new Date(),
  checkInDay?: string | null
): TriggerResult | null {
  const todayStr = getDateString(now)
  const weekStartStr = getTrainingWeekStart(todayStr, checkInDay)

  // Past events in the current training week (strictly before today)
  const weekEvents = events.filter(e => e.date >= weekStartStr && e.date < todayStr)

  const missedDates: string[] = []
  for (const event of weekEvents) {
    if (event.status === "scheduled" || event.status === "missed" || event.status === "skipped") {
      missedDates.push(event.date)
    }
  }

  if (missedDates.length >= TRAINING_MISSED_WEEKLY_THRESHOLD) {
    return {
      type: "training_missed",
      severity: "high",
      message: `${missedDates.length} training sessions missed this week`,
      affectedDays: missedDates,
      metricData: []
    }
  }
  return null
}

/**
 * Evaluates if a client consistently logs partial completions.
 * Uses event-count-based lookback (not calendar windows) so it works for any
 * program shape — prescribed training days don't align to 7-day weeks.
 */
export function evaluatePartialTrainingPattern(
  events: TrainingEventRow[]
): TriggerResult | null {
  // Only consider resolved events (exclude future/today scheduled events)
  const resolved = events
    .filter(e => e.status === "completed" || e.status === "partial" || e.status === "missed" || e.status === "skipped")
    .sort((a, b) => b.date.localeCompare(a.date))

  // Sparse data guard — need enough events to evaluate
  if (resolved.length < PARTIAL_TRAINING_LOOKBACK_EVENTS) {
    return null
  }

  const lookback = resolved.slice(0, PARTIAL_TRAINING_LOOKBACK_EVENTS)
  const partialEvents = lookback.filter(e => e.status === "partial")

  if (partialEvents.length >= PARTIAL_TRAINING_THRESHOLD) {
    return {
      type: "partial_training_pattern",
      severity: "medium",
      message: `${partialEvents.length} of last ${PARTIAL_TRAINING_LOOKBACK_EVENTS} training sessions only partially completed`,
      affectedDays: partialEvents.map(e => e.date),
      metricData: []
    }
  }
  return null
}