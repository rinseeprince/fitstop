import type { DailyLog } from "@/types/daily-log"
import type { TriggerResult } from "./attention-triggers"
import {
  LOGGING_GAP_THRESHOLD_DAYS,
  NUTRITION_MISSED_CONSECUTIVE_DAYS,
  TRAINING_MISSED_WEEKLY_THRESHOLD,
} from "@/lib/constants"
import { getDateString, getTrainingWeekStart } from "@/lib/date-helpers"

/**
 * Evaluates if there's a gap in daily logging
 */
export function evaluateLoggingGap(
  logs: DailyLog[],
  dateRange: { start: string; end: string }
): TriggerResult | null {
  if (logs.length === 0) return null
  const sortedLogs = [...logs].sort((a, b) => a.date.localeCompare(b.date))
  const missingDays: string[] = []
  // Check for gaps between existing logs
  for (let i = 1; i < sortedLogs.length; i++) {
    const currentDate = new Date(sortedLogs[i].date + 'T00:00:00')
    const previousDate = new Date(sortedLogs[i - 1].date + 'T00:00:00')
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
  // Check gap from last log to end date
  if (sortedLogs.length > 1) {
    const endDate = new Date(dateRange.end + 'T00:00:00')
    const mostRecentDate = new Date(sortedLogs[sortedLogs.length - 1].date + 'T00:00:00')
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
 */
export function evaluateTrainingMisses(
  logs: DailyLog[],
  plannedSessionCount: number,
  now: Date = new Date(),
  checkInDay?: string | null
): TriggerResult | null {
  // Get current week's logs based on client's check-in day
  const today = now
  const todayStr = getDateString(today)
  const weekStartStr = getTrainingWeekStart(todayStr, checkInDay)
  const startOfWeek = new Date(weekStartStr + 'T00:00:00')
  const weekLogs = logs.filter(log => {
    const logDate = new Date(log.date + 'T00:00:00')
    return logDate >= startOfWeek
  })
  const missedSessions: string[] = []
  for (const log of weekLogs) {
    // Check if there was a scheduled training session that wasn't completed
    if (log.trainingData?.trainingSessionId && !log.trainingData?.sessionCompleted) {
      missedSessions.push(log.date)
    }
  }
  if (missedSessions.length >= TRAINING_MISSED_WEEKLY_THRESHOLD) {
    return {
      type: "training_missed",
      severity: "high",
      message: `${missedSessions.length} training sessions missed this week`,
      affectedDays: missedSessions,
      metricData: []
    }
  }
  return null
}