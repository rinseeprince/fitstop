import type { DailyLog } from "@/types/daily-log"
import type { DailyHabit, DailyHabitLog } from "@/types/daily-habit"
import type { TriggerResult } from "./attention-triggers"
import {
  HABIT_DROPOFF_THRESHOLD_PERCENT,
  HABIT_DROPOFF_DAYS_IN_WEEK,
  ACTIVITY_CAL_MISMATCH_DAY_COUNT,
  ACTIVITY_CAL_MISMATCH_WINDOW_DAYS,
} from "@/lib/constants"
import { getDateString } from "@/lib/date-helpers"

/**
 * Evaluates if habit completion has dropped off
 */
export function evaluateHabitDropoff(
  habitLogs: DailyHabitLog[],
  habits: DailyHabit[]
): TriggerResult | null {
  if (!habits.length || !habitLogs.length) return null
  
  // Get last 7 days
  const today = new Date()
  const sevenDaysAgo = new Date(today)
  sevenDaysAgo.setDate(today.getDate() - 6)
  
  const dailyCompletionRates: { date: string; rate: number }[] = []
  const affectedDays: string[] = []
  
  // Calculate completion rate for each of the last 7 days
  for (let i = 0; i < 7; i++) {
    const checkDate = new Date(sevenDaysAgo)
    checkDate.setDate(sevenDaysAgo.getDate() + i)
    const dateStr = getDateString(checkDate)
    
    // Only count habits that existed on this day (created_at <= day)
    const habitsOnThisDay = habits.filter(habit => {
      const habitCreatedDate = new Date(habit.createdAt.split('T')[0] + 'T00:00:00')
      return habitCreatedDate <= checkDate
    })
    
    if (habitsOnThisDay.length === 0) continue
    
    // Count completed habits for this day
    const completedCount = habitLogs.filter(log => 
      log.date === dateStr && 
      log.completed &&
      habitsOnThisDay.some(h => h.id === log.dailyHabitId)
    ).length
    
    const completionRate = (completedCount / habitsOnThisDay.length) * 100
    dailyCompletionRates.push({ date: dateStr, rate: completionRate })
    
    if (completionRate < HABIT_DROPOFF_THRESHOLD_PERCENT) {
      affectedDays.push(dateStr)
    }
  }
  
  // Check if completion rate was below threshold for 5+ of the last 7 days
  if (affectedDays.length >= HABIT_DROPOFF_DAYS_IN_WEEK) {
    const metricData = dailyCompletionRates.map(d => ({
      date: d.date,
      value: Math.round(d.rate)
    }))
    
    return {
      type: "habit_dropoff",
      severity: "medium",
      message: `Daily habit completion below ${HABIT_DROPOFF_THRESHOLD_PERCENT}% for ${affectedDays.length} of the last 7 days`,
      affectedDays: affectedDays.slice(-HABIT_DROPOFF_DAYS_IN_WEEK),
      metricData
    }
  }
  
  return null
}

/**
 * Evaluates if client ate as if they completed activities they actually skipped
 */
export function evaluateActivityCalMismatch(
  logs: DailyLog[],
  now: Date = new Date()
): TriggerResult | null {
  // Only look at logs within the window
  const windowStart = new Date(now)
  windowStart.setDate(windowStart.getDate() - ACTIVITY_CAL_MISMATCH_WINDOW_DAYS)
  
  const recentLogs = logs.filter(log => {
    const logDate = new Date(log.date + 'T00:00:00')
    return logDate >= windowStart
  })
  
  const mismatchDays: string[] = []
  const metricData: Array<{ date: string; value: number }> = []
  
  for (const log of recentLogs) {
    if (!log.trainingData?.activityStatuses || !log.caloriesConsumed || !log.targetCalories) {
      continue
    }
    
    // Calculate calories from skipped activities
    let skippedActivityCalories = 0
    for (const [_, activity] of Object.entries(log.trainingData.activityStatuses)) {
      // Check the .completed field, not the object itself
      if (!activity.completed && activity.estimatedCalories) {
        skippedActivityCalories += activity.estimatedCalories
      }
    }
    
    // Check if client ate calories that included skipped activities
    // Target calories already includes planned activities, so if they skipped activities
    // but still ate the full target amount, they overate relative to what they actually did
    if (skippedActivityCalories > 0 && 
        log.caloriesConsumed >= log.targetCalories) {
      mismatchDays.push(log.date)
      metricData.push({ date: log.date, value: log.caloriesConsumed })
    }
  }
  
  // Check if we have enough mismatches AND at least one is recent (last 7 days)
  if (mismatchDays.length >= ACTIVITY_CAL_MISMATCH_DAY_COUNT) {
    const sevenDaysAgo = new Date(now)
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    
    const hasRecentMismatch = mismatchDays.some(day => {
      const dayDate = new Date(day + 'T00:00:00')
      return dayDate >= sevenDaysAgo
    })
    
    if (hasRecentMismatch) {
      return {
        type: "activity_cal_mismatch",
        severity: "high",
        message: `Calorie intake matched planned activities despite skipping them on ${mismatchDays.length} days`,
        affectedDays: mismatchDays.slice(0, ACTIVITY_CAL_MISMATCH_DAY_COUNT),
        metricData: metricData.slice(-7) // Last 7 data points
      }
    }
  }
  
  return null
}