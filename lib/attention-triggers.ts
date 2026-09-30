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
  /** The habit a missed-habit line is about; absent on every other trigger. */
  habitId?: string
}

// Re-export all trigger functions from split files
export { evaluateMoodEnergyDrop, evaluateHighStress, evaluateHighSoreness } from "./wellness-triggers"
export { evaluateLoggingGap, evaluateNutritionMisses, evaluateTrainingMisses, evaluatePartialTrainingPattern } from "./tracking-triggers"
export { evaluateMissedHabits, evaluateActivityCalMismatch } from "./activity-triggers"
export { evaluateNoEngagement } from "./engagement-triggers"
export { evaluatePrescriptionEnding } from "./prescription-triggers"