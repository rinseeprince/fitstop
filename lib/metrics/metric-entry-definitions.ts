// Canonical constants for coach-logged metric entries (client_metric_entries).
// Isomorphic: imported by the zod schema (server), the service, and the
// Metrics-page UI. METRIC_ENTRY_KEYS must stay in lockstep with the
// METRIC_DEFINITIONS ids (components/clients/metrics/hooks/use-metrics-data.ts)
// AND the metric_key CHECK constraint in migration 132.

export const METRIC_ENTRY_KEYS = [
  "weight",
  "bodyFat",
  "waist",
  "hips",
  "chest",
  "arms",
  "thighs",
  "mood",
  "energy",
  "sleep",
  "stress",
  "soreness",
] as const;

export type MetricEntryKey = (typeof METRIC_ENTRY_KEYS)[number];

// Value bounds reuse the platform's existing ranges: weight/bodyFat from
// lib/validations/client-metrics.ts, girths from lib/validations/check-in.ts,
// wellness scales from the wellness card schema (mood 1-5, others 1-10).
export const METRIC_VALUE_RANGES: Record<
  MetricEntryKey,
  { min: number; max: number; integer: boolean }
> = {
  weight: { min: 20, max: 700, integer: false },
  bodyFat: { min: 3, max: 60, integer: false },
  waist: { min: 1, max: 200, integer: false },
  hips: { min: 1, max: 200, integer: false },
  chest: { min: 1, max: 200, integer: false },
  arms: { min: 1, max: 100, integer: false },
  thighs: { min: 1, max: 100, integer: false },
  mood: { min: 1, max: 5, integer: true },
  energy: { min: 1, max: 10, integer: true },
  sleep: { min: 1, max: 10, integer: true },
  stress: { min: 1, max: 10, integer: true },
  soreness: { min: 1, max: 10, integer: true },
};

// The metric's good direction: a falling value reads as improvement for these
// (mirrors the shared chart's stress/soreness inversion plus the body metrics).
export const DOWN_IS_GOOD: ReadonlySet<MetricEntryKey> = new Set<MetricEntryKey>([
  "weight",
  "bodyFat",
  "waist",
  "hips",
  "chest",
  "arms",
  "thighs",
  "stress",
  "soreness",
]);
