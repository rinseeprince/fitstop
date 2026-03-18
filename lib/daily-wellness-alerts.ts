import type { DailyLog } from "@/types/daily-log"
import type { WellnessAlert } from "@/types/attention-feed"
import {
  evaluateMoodEnergyDrop,
  evaluateLoggingGap,
  evaluateNutritionMisses,
  evaluateTrainingMisses,
  evaluateHighStress
} from "@/lib/attention-triggers"

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
      type: moodDropResult.type,
      severity: moodDropResult.severity,
      message: moodDropResult.message,
      affectedDays: moodDropResult.affectedDays
    })
  }
  
  // 2. Check for energy drop
  const energyDropResult = evaluateMoodEnergyDrop(dailyLogs, "energy")
  if (energyDropResult) {
    alerts.push({
      type: energyDropResult.type,
      severity: energyDropResult.severity,
      message: energyDropResult.message,
      affectedDays: energyDropResult.affectedDays
    })
  }
  
  // 3. Check for no log gap
  const noLogGapResult = evaluateLoggingGap(dailyLogs, dateRange)
  if (noLogGapResult) {
    alerts.push({
      type: noLogGapResult.type,
      severity: noLogGapResult.severity,
      message: noLogGapResult.message,
      affectedDays: noLogGapResult.affectedDays
    })
  }
  
  // 4. Check for nutrition missed
  const nutritionMissedResult = evaluateNutritionMisses(dailyLogs)
  if (nutritionMissedResult) {
    alerts.push({
      type: nutritionMissedResult.type,
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
      type: trainingMissedResult.type,
      severity: trainingMissedResult.severity,
      message: trainingMissedResult.message,
      affectedDays: trainingMissedResult.affectedDays
    })
  }
  
  // 6. Check for high stress
  const highStressResult = evaluateHighStress(dailyLogs)
  if (highStressResult) {
    alerts.push({
      type: highStressResult.type,
      severity: highStressResult.severity,
      message: highStressResult.message,
      affectedDays: highStressResult.affectedDays
    })
  }
  
  return alerts
}