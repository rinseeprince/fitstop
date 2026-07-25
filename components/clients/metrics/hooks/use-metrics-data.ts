import type { CheckIn } from "@/types/check-in";

// Retained for the shared MetricChartCard (also consumed by the client portal's
// metrics-hub).
export type DateRangeFilter = "7d" | "30d" | "90d" | "all";
export type MetricCategory = "body" | "wellness";

export type MetricDefinition = {
  id: string;
  name: string;
  key: keyof CheckIn;
  category: MetricCategory;
  getUnit: (weightUnit?: string, measurementUnit?: string) => string;
  domain?: [number, number];
};

// The coach metric catalog — the single source for metric ids/names/units.
// The merged-series pipeline (use-merged-metrics → utils/metric-points)
// consumes these definitions; the old useMetricsData hook was retired with the
// Metrics page redesign (its latest/previous + trend semantics live on in
// utils/metric-shaping and utils/metric-derived-stats).
export const METRIC_DEFINITIONS: MetricDefinition[] = [
  // Body metrics
  { id: "weight", name: "Weight", key: "weight", category: "body", getUnit: (w) => w || "lbs" },
  { id: "bodyFat", name: "Body Fat", key: "bodyFatPercentage", category: "body", getUnit: () => "%" },
  { id: "waist", name: "Waist", key: "waist", category: "body", getUnit: (_, m) => m || "in" },
  { id: "hips", name: "Hips", key: "hips", category: "body", getUnit: (_, m) => m || "in" },
  { id: "chest", name: "Chest", key: "chest", category: "body", getUnit: (_, m) => m || "in" },
  { id: "arms", name: "Arms", key: "arms", category: "body", getUnit: (_, m) => m || "in" },
  { id: "thighs", name: "Thighs", key: "thighs", category: "body", getUnit: (_, m) => m || "in" },
  // Wellness metrics
  { id: "mood", name: "Mood", key: "mood", category: "wellness", getUnit: () => "/5", domain: [1, 5] },
  { id: "energy", name: "Energy", key: "energy", category: "wellness", getUnit: () => "/10", domain: [1, 10] },
  { id: "sleep", name: "Sleep", key: "sleep", category: "wellness", getUnit: () => "/10", domain: [1, 10] },
  { id: "stress", name: "Stress", key: "stress", category: "wellness", getUnit: () => "/10", domain: [1, 10] },
  { id: "soreness", name: "Soreness", key: "soreness", category: "wellness", getUnit: () => "/10", domain: [1, 10] },
];
