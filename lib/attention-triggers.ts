/**
 * Barrel export for attention trigger functions
 * Split across multiple files to maintain file size limits
 */

import type { AlertType, AlertSeverity } from "@/types/attention-feed"

// Type definitions
export interface MetricDataPoint {
  date: string
  value: number
}

export interface TriggerResult {
  type: AlertType
  severity: AlertSeverity
  message: string
  affectedDays: string[]
  metricData: MetricDataPoint[]
}

// Re-export all trigger functions from split files
export { evaluateMoodEnergyDrop, evaluateHighStress } from "./wellness-triggers"
export { evaluateLoggingGap, evaluateNutritionMisses, evaluateTrainingMisses, evaluatePartialTrainingPattern } from "./tracking-triggers"
export { evaluateHabitDropoff, evaluateActivityCalMismatch } from "./activity-triggers"