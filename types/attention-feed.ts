import type { MetricDataPoint } from "@/lib/attention-triggers"

// Core alert types (moved here to avoid circular dependencies)
export type AlertSeverity = "high" | "medium" | "low"

export type AlertType = 
  | "mood_drop"
  | "energy_drop"
  | "no_log_gap"
  | "nutrition_missed"
  | "training_missed"
  | "high_stress"
  | "high_soreness"
  | "habit_dropoff"
  | "activity_cal_mismatch"
  | "partial_training_pattern"
  | "no_engagement"

export interface WellnessAlert {
  type: AlertType
  severity: AlertSeverity
  message: string
  affectedDays: string[] // Array of date strings (YYYY-MM-DD)
}

// Extended alert with metric data for visualization
export interface AttentionAlert extends WellnessAlert {
  metricData: MetricDataPoint[] // Last 7 data points for sparkline
}

// Client with their triggered alerts
export interface ClientWithAlerts {
  clientId: string
  clientName: string
  clientAvatar: string | null
  alerts: AttentionAlert[]
}

// API response shape
export interface AttentionFeedResponse {
  success: boolean
  data: {
    clients: ClientWithAlerts[]
    totalClientCount: number
  }
}