import type { CheckIn } from "@/types/check-in";
import type { UnitSystem } from "@/utils/unit-conversions";

// Retained for the shared MetricChartCard (also consumed by the client portal's
// metrics-hub).
export type DateRangeFilter = "7d" | "30d" | "90d" | "all";
export type MetricCategory = "body" | "wellness";

export type MetricDefinition = {
  id: string;
  name: string;
  key: keyof CheckIn;
  category: MetricCategory;
  /**
   * The VIEWER's unit for this metric. Previously took the client's stored
   * weight/measurement tags — which by migration 141 were mapper constants, so
   * girths were labelled "in" over centimetre values on every screen.
   */
  getUnit: (viewer: UnitSystem) => string;
  /** How the stored value converts for display. Wellness scores have no unit. */
  convert?: "weight" | "length";
  domain?: [number, number];
};

// The coach metric catalog — the single source for metric ids/names/units.
// The merged-series pipeline (use-merged-metrics → utils/metric-points)
// consumes these definitions; the old useMetricsData hook was retired with the
// Metrics page redesign (its latest/previous + trend semantics live on in
// utils/metric-shaping and utils/metric-derived-stats).
export const METRIC_DEFINITIONS: MetricDefinition[] = [
  // Body metrics
  { id: "weight", name: "Weight", key: "weight", category: "body", getUnit: (v) => (v === "imperial" ? "lbs" : "kg"), convert: "weight" },
  { id: "bodyFat", name: "Body Fat", key: "bodyFatPercentage", category: "body", getUnit: () => "%" },
  { id: "waist", name: "Waist", key: "waist", category: "body", getUnit: (v) => (v === "imperial" ? "in" : "cm"), convert: "length" },
  { id: "hips", name: "Hips", key: "hips", category: "body", getUnit: (v) => (v === "imperial" ? "in" : "cm"), convert: "length" },
  { id: "chest", name: "Chest", key: "chest", category: "body", getUnit: (v) => (v === "imperial" ? "in" : "cm"), convert: "length" },
  { id: "arms", name: "Arms", key: "arms", category: "body", getUnit: (v) => (v === "imperial" ? "in" : "cm"), convert: "length" },
  { id: "thighs", name: "Thighs", key: "thighs", category: "body", getUnit: (v) => (v === "imperial" ? "in" : "cm"), convert: "length" },
  // Wellness metrics
  { id: "mood", name: "Mood", key: "mood", category: "wellness", getUnit: () => "/5", domain: [1, 5] },
  { id: "energy", name: "Energy", key: "energy", category: "wellness", getUnit: () => "/10", domain: [1, 10] },
  { id: "sleep", name: "Sleep", key: "sleep", category: "wellness", getUnit: () => "/10", domain: [1, 10] },
  { id: "stress", name: "Stress", key: "stress", category: "wellness", getUnit: () => "/10", domain: [1, 10] },
  { id: "soreness", name: "Soreness", key: "soreness", category: "wellness", getUnit: () => "/10", domain: [1, 10] },
];
