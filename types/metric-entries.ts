import type { MetricEntryKey } from "@/lib/metrics/metric-entry-definitions";

/** A coach's Log-measurement entry as the route answers it: the measurement
 *  log's row, in the entry shape the Journey's caller reads. */
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
