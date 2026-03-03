/**
 * Barrel export for attention trigger functions
 * Split across multiple files to maintain file size limits
 */

import type { AlertSeverity } from "@/lib/daily-wellness-alerts"

// Type definitions
export interface MetricDataPoint {
  date: string
  value: number
}

export interface TriggerResult {
  type: string
  severity: AlertSeverity
  message: string
  affectedDays: string[]
  metricData: MetricDataPoint[]
}

// Re-export all trigger functions from split files
export { evaluateMoodEnergyDrop, evaluateHighStress } from "./wellness-triggers"
export { evaluateLoggingGap, evaluateNutritionMisses, evaluateTrainingMisses } from "./tracking-triggers"
export { evaluateHabitDropoff, evaluateActivityCalMismatch } from "./activity-triggers"