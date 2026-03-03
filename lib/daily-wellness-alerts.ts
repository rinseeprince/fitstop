import type { DailyLog } from "@/types/daily-log"
import {
  evaluateMoodEnergyDrop,
  evaluateLoggingGap,
  evaluateNutritionMisses,
  evaluateTrainingMisses,
  evaluateHighStress
} from "@/lib/attention-triggers"

export type AlertSeverity = "high" | "medium" | "low"

export type AlertType = 
  | "mood_drop"
  | "energy_drop"
  | "no_log_gap"
  | "nutrition_missed"
  | "training_missed"
  | "high_stress"
  | "habit_dropoff"
  | "activity_cal_mismatch"

export interface WellnessAlert {
  type: AlertType
  severity: AlertSeverity
  message: string
  affectedDays: string[] // Array of date strings (YYYY-MM-DD)
}

/**
 * Detects wellness alerts based on patterns in daily logs
 * @param dailyLogs Array of daily logs sorted by date (newest first)
 * @param now Optional current date for testing (defaults to today)
 * @returns Array of detected alerts
 */
export function detectAlerts(dailyLogs: DailyLog[], now: Date = new Date()): WellnessAlert[] {
  if (!dailyLogs || dailyLogs.length === 0) {
    return []
  }

  const alerts: WellnessAlert[] = []
  const endDate = now.toISOString().split('T')[0]
  const startDate = new Date(now)
  startDate.setDate(now.getDate() - 28)
  const dateRange = { start: startDate.toISOString().split('T')[0], end: endDate }
  
  // 1. Check for mood drop
  const moodDropResult = evaluateMoodEnergyDrop(dailyLogs, "mood")
  if (moodDropResult) {
    alerts.push({
      type: moodDropResult.type as AlertType,
      severity: moodDropResult.severity,
      message: moodDropResult.message,
      affectedDays: moodDropResult.affectedDays
    })
  }
  
  // 2. Check for energy drop
  const energyDropResult = evaluateMoodEnergyDrop(dailyLogs, "energy")
  if (energyDropResult) {
    alerts.push({
      type: energyDropResult.type as AlertType,
      severity: energyDropResult.severity,
      message: energyDropResult.message,
      affectedDays: energyDropResult.affectedDays
    })
  }
  
  // 3. Check for no log gap
  const noLogGapResult = evaluateLoggingGap(dailyLogs, dateRange)
  if (noLogGapResult) {
    alerts.push({
      type: noLogGapResult.type as AlertType,
      severity: noLogGapResult.severity,
      message: noLogGapResult.message,
      affectedDays: noLogGapResult.affectedDays
    })
  }
  
  // 4. Check for nutrition missed
  const nutritionMissedResult = evaluateNutritionMisses(dailyLogs)
  if (nutritionMissedResult) {
    alerts.push({
      type: nutritionMissedResult.type as AlertType,
      severity: nutritionMissedResult.severity,
      message: nutritionMissedResult.message,
      affectedDays: nutritionMissedResult.affectedDays
    })
  }
  
  // 5. Check for training missed
  // Note: plannedSessionCount would need to be passed in for full implementation
  // For backward compatibility, using a default of 3 sessions per week
  const trainingMissedResult = evaluateTrainingMisses(dailyLogs, 3, now)
  if (trainingMissedResult) {
    alerts.push({
      type: trainingMissedResult.type as AlertType,
      severity: trainingMissedResult.severity,
      message: trainingMissedResult.message,
      affectedDays: trainingMissedResult.affectedDays
    })
  }
  
  // 6. Check for high stress
  const highStressResult = evaluateHighStress(dailyLogs)
  if (highStressResult) {
    alerts.push({
      type: highStressResult.type as AlertType,
      severity: highStressResult.severity,
      message: highStressResult.message,
      affectedDays: highStressResult.affectedDays
    })
  }
  
  return alerts
}

// Legacy functions kept for backward compatibility with tests
// These now just wrap the extracted functions from attention-triggers.ts

/**
 * Checks if a metric has dropped below rolling average for consecutive days
 * @deprecated Use evaluateMoodEnergyDrop from attention-triggers.ts instead
 */
function checkMetricDrop(
  logs: DailyLog[],
  metric: "mood" | "energy",
  dropThreshold: number,
  consecutiveDays: number,
  rollingDays: number
): string[] | null {
  // Need enough data to calculate a meaningful baseline
  if (logs.length < rollingDays + consecutiveDays) {
    return null
  }
  
  // Look for patterns where we have consecutive days below the rolling average
  for (let i = rollingDays; i < logs.length; i++) {
    // Check if we have enough remaining days for a consecutive pattern
    if (i + consecutiveDays - 1 >= logs.length) {
      break
    }
    
    // Calculate the baseline average from the rollingDays before this position
    const baselineStart = i - rollingDays
    const baselineEnd = i
    const baselineLogs = logs.slice(baselineStart, baselineEnd)
    const baselineValues = baselineLogs
      .map(log => log[metric])
      .filter(val => val !== undefined && val !== null) as number[]
    
    if (baselineValues.length < Math.min(3, rollingDays)) {
      continue // Not enough valid data for baseline
    }
    
    const baselineAvg = baselineValues.reduce((sum, val) => sum + val, 0) / baselineValues.length
    
    // Check if the next consecutiveDays are all below threshold
    const affectedDays: string[] = []
    let allBelowThreshold = true
    
    for (let j = 0; j < consecutiveDays; j++) {
      const checkIndex = i + j
      if (checkIndex >= logs.length) {
        allBelowThreshold = false
        break
      }
      
      const value = logs[checkIndex][metric]
      if (value === undefined || value === null || value > baselineAvg - dropThreshold) {
        allBelowThreshold = false
        break
      }
      
      affectedDays.push(logs[checkIndex].date)
    }
    
    if (allBelowThreshold && affectedDays.length === consecutiveDays) {
      return affectedDays
    }
  }
  
  return null
}

/**
 * Checks for gaps in daily logging
 */
function checkNoLogGap(logs: DailyLog[], gapThreshold: number, now: Date = new Date()): string[] | null {
  if (logs.length === 0) return null
  
  const missingDays: string[] = []
  
  // First check for gaps between existing logs in the provided data
  for (let i = 1; i < logs.length; i++) {
    const currentDate = new Date(logs[i].date + 'T00:00:00')
    const previousDate = new Date(logs[i - 1].date + 'T00:00:00')
    const daysBetween = Math.floor((currentDate.getTime() - previousDate.getTime()) / (1000 * 60 * 60 * 24))
    
    if (daysBetween > gapThreshold) {
      // Found a gap of more than threshold days
      for (let j = 1; j < daysBetween && j <= gapThreshold; j++) {
        const missingDate = new Date(previousDate)
        missingDate.setDate(missingDate.getDate() + j)
        missingDays.push(missingDate.toISOString().split('T')[0])
      }
      return missingDays.slice(0, gapThreshold)
    }
  }
  
  // Only check gap from last log to today if we have multiple logs
  // (for a single log, we don't know if it's the start of tracking or not)
  if (logs.length > 1) {
    // Get today's date in YYYY-MM-DD format
    const todayStr = now.toISOString().split('T')[0]
    const todayDate = new Date(todayStr + 'T00:00:00')
    
    const mostRecentLog = logs[logs.length - 1]
    const mostRecentDate = new Date(mostRecentLog.date + 'T00:00:00')
    
    // Calculate days between most recent log and today
    const daysSinceLastLog = Math.floor((todayDate.getTime() - mostRecentDate.getTime()) / (1000 * 60 * 60 * 24))
    
    // Only trigger if there's a gap of threshold or more days
    if (daysSinceLastLog >= gapThreshold) {
      // Generate list of missing days
      for (let i = 1; i <= Math.min(daysSinceLastLog, gapThreshold); i++) {
        const missingDate = new Date(mostRecentDate)
        missingDate.setDate(missingDate.getDate() + i)
        missingDays.push(missingDate.toISOString().split('T')[0])
      }
      return missingDays.slice(0, gapThreshold)
    }
  }
  
  return null
}

/**
 * Checks for consecutive days with missed nutrition
 */
function checkNutritionMissed(logs: DailyLog[], threshold: number): string[] | null {
  let consecutiveMissed = 0
  const affectedDays: string[] = []
  
  // Iterate forward through logs for proper chronological order
  for (let i = 0; i < logs.length; i++) {
    if (logs[i].nutritionAdherence === "missed") {
      consecutiveMissed++
      affectedDays.push(logs[i].date)
      
      if (consecutiveMissed >= threshold) {
        // Return the most recent N consecutive days
        return affectedDays.slice(-threshold)
      }
    } else {
      consecutiveMissed = 0
      affectedDays.length = 0
    }
  }
  
  return null
}

/**
 * Checks for missed training sessions in the current week
 */
function checkTrainingMissed(logs: DailyLog[], threshold: number, now: Date = new Date()): string[] | null {
  const today = now
  const startOfWeek = new Date(today)
  const dayOfWeek = today.getDay()
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1 // Monday is start of week
  startOfWeek.setDate(today.getDate() - diff)
  startOfWeek.setHours(0, 0, 0, 0)
  
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
  
  if (missedSessions.length >= threshold) {
    return missedSessions
  }
  
  return null
}

/**
 * Checks for consecutive days with high stress
 */
function checkHighStress(logs: DailyLog[], stressThreshold: number, consecutiveDays: number): string[] | null {
  let consecutiveHighStress = 0
  const affectedDays: string[] = []
  
  // Iterate forward through logs for proper chronological order
  for (let i = 0; i < logs.length; i++) {
    const stress = logs[i].stress
    
    if (stress !== undefined && stress !== null && stress >= stressThreshold) {
      consecutiveHighStress++
      affectedDays.push(logs[i].date)
      
      if (consecutiveHighStress >= consecutiveDays) {
        // Return the most recent N consecutive days
        return affectedDays.slice(-consecutiveDays)
      }
    } else {
      consecutiveHighStress = 0
      affectedDays.length = 0
    }
  }
  
  return null
}