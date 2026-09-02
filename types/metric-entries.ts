import type { MetricEntryKey } from "@/lib/metrics/metric-entry-definitions";

// Snake_case row as stored in client_metric_entries — the coach-logged
// WELLNESS entries (matches the generated types/database.ts shape; hand-typed
// for narrowing).
export interface MetricEntryRow {
  id: string;
  client_id: string;
  metric_key: string;
  value: number;
  entry_date: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MetricEntry {
  id: string;
  clientId: string;
  metricKey: MetricEntryKey;
  value: number;
  entryDate: string; // YYYY-MM-DD
  note?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMetricEntryRequest {
  metricKey: MetricEntryKey;
  value: number;
  entryDate: string; // YYYY-MM-DD
  note?: string;
}

export interface GetMetricEntriesResponse {
  success: boolean;
  data: MetricEntry[];
}
