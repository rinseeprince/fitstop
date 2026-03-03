import type { WellnessAlert, AlertType } from "@/lib/daily-wellness-alerts"
import type { MetricDataPoint } from "@/lib/attention-triggers"

// Extended alert with metric data for visualization
// Uses the same AlertType union from daily-wellness-alerts.ts (single source of truth)
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
  }
}

// Re-export AlertType for convenience
export type { AlertType } from "@/lib/daily-wellness-alerts"