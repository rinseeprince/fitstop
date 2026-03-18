import type { DailyLog } from "@/types/daily-log"
import type { TriggerResult } from "./attention-triggers"
import {
  MOOD_ENERGY_DROP_THRESHOLD,
  MOOD_ENERGY_DROP_CONSECUTIVE_DAYS,
  MOOD_ENERGY_ROLLING_DAYS,
  HIGH_STRESS_THRESHOLD,
  HIGH_STRESS_CONSECUTIVE_DAYS,
} from "@/lib/constants"

/**
 * Evaluates if mood or energy has dropped below rolling average
 */
export function evaluateMoodEnergyDrop(
  logs: DailyLog[],
  metric: "mood" | "energy"
): TriggerResult | null {
  if (logs.length < MOOD_ENERGY_ROLLING_DAYS + MOOD_ENERGY_DROP_CONSECUTIVE_DAYS) {
    return null
  }

  // Sort logs by date ascending for chronological processing
  const sortedLogs = [...logs].sort((a, b) => a.date.localeCompare(b.date))
  let lastValidStreak: { affectedDays: string[], baselineAvg: number } | null = null
  
  // Look for patterns where consecutive days are below rolling average
  for (let i = MOOD_ENERGY_ROLLING_DAYS; i < sortedLogs.length; i++) {
    if (i + MOOD_ENERGY_DROP_CONSECUTIVE_DAYS - 1 >= sortedLogs.length) {
      break
    }
    
    // Calculate baseline average from rolling days before this position
    const baselineStart = i - MOOD_ENERGY_ROLLING_DAYS
    const baselineLogs = sortedLogs.slice(baselineStart, i)
    const baselineValues = baselineLogs
      .map(log => log[metric])
      .filter(val => val !== undefined && val !== null)
    
    if (baselineValues.length < Math.min(3, MOOD_ENERGY_ROLLING_DAYS)) {
      continue // Not enough data for baseline
    }
    
    const baselineAvg = baselineValues.reduce((sum, val) => sum + val, 0) / baselineValues.length
    
    // Check if the next consecutive days are all below threshold
    const affectedDays: string[] = []
    let allBelowThreshold = true
    
    for (let j = 0; j < MOOD_ENERGY_DROP_CONSECUTIVE_DAYS; j++) {
      const checkIndex = i + j
      const value = sortedLogs[checkIndex][metric]
      if (value === undefined || value === null || value > baselineAvg - MOOD_ENERGY_DROP_THRESHOLD) {
        allBelowThreshold = false
        break
      }
      affectedDays.push(sortedLogs[checkIndex].date)
    }
    
    if (allBelowThreshold && affectedDays.length === MOOD_ENERGY_DROP_CONSECUTIVE_DAYS) {
      const streakEndIndex = i + MOOD_ENERGY_DROP_CONSECUTIVE_DAYS - 1
      
      // Check if this streak extends to the most recent log OR there are no logs after it
      if (streakEndIndex === sortedLogs.length - 1 || streakEndIndex === sortedLogs.length - 2) {
        lastValidStreak = { affectedDays, baselineAvg }
      }
    }
  }
  
  // Only return alert if we found a valid streak that's still ongoing or recent
  if (lastValidStreak) {
    // Get last 7 data points for sparkline
    const recentLogs = sortedLogs.slice(-7)
    const metricData = recentLogs
      .filter(log => log[metric] !== undefined && log[metric] !== null)
      .map(log => ({ date: log.date, value: log[metric]! }))
    
    return {
      type: `${metric}_drop`,
      severity: "high",
      message: `${metric === "mood" ? "Mood" : "Energy"} has dropped significantly below average for ${MOOD_ENERGY_DROP_CONSECUTIVE_DAYS}+ consecutive days`,
      affectedDays: lastValidStreak.affectedDays,
      metricData
    }
  }
  
  return null
}

/**
 * Evaluates if stress has been high consecutively
 */
export function evaluateHighStress(logs: DailyLog[]): TriggerResult | null {
  const sortedLogs = [...logs].sort((a, b) => a.date.localeCompare(b.date))
  let consecutiveHighStress = 0
  let currentStreakDays: string[] = []
  let lastValidStreak: string[] | null = null
  
  for (let i = 0; i < sortedLogs.length; i++) {
    const stress = sortedLogs[i].stress
    
    if (stress !== undefined && stress !== null && stress >= HIGH_STRESS_THRESHOLD) {
      consecutiveHighStress++
      currentStreakDays.push(sortedLogs[i].date)
      
      if (consecutiveHighStress >= HIGH_STRESS_CONSECUTIVE_DAYS) {
        // Check if this is the last streak (extends to end or near end of data)
        if (i === sortedLogs.length - 1 || i === sortedLogs.length - 2) {
          lastValidStreak = [...currentStreakDays]
        }
      }
    } else {
      consecutiveHighStress = 0
      currentStreakDays = []
    }
  }
  
  // Only return alert if the last valid streak exists (pattern is ongoing/recent)
  if (lastValidStreak && lastValidStreak.length >= HIGH_STRESS_CONSECUTIVE_DAYS) {
    // Get last 7 stress data points for sparkline
    const recentLogs = sortedLogs.slice(-7)
    const metricData = recentLogs
      .filter(log => log.stress !== undefined && log.stress !== null)
      .map(log => ({ date: log.date, value: log.stress! }))
    
    return {
      type: "high_stress",
      severity: "high",
      message: `Stress levels critically high for ${HIGH_STRESS_CONSECUTIVE_DAYS}+ consecutive days`,
      affectedDays: lastValidStreak.slice(-HIGH_STRESS_CONSECUTIVE_DAYS),
      metricData
    }
  }
  
  return null
}