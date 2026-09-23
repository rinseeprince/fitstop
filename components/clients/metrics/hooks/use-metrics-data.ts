import type { UnitSystem } from "@/utils/unit-conversions";
import type { MeasurementKey } from "@/lib/measurements/keys";
import type { WellnessKey } from "@/lib/wellness/keys";

// Retained for the shared MetricChartCard (also consumed by the client portal's
// metrics-hub).
export type DateRangeFilter = "7d" | "30d" | "90d" | "all";

/**
 * A Journey metric. Its id IS the key of the store its series comes from — a
 * measurement-log key for a physique metric, a daily-log column for a
 * wellness one — so the id alone finds the metric's series.
 */
export type MetricDefinition<Id extends MeasurementKey | WellnessKey = MeasurementKey | WellnessKey> = {
  id: Id;
  name: string;
  category: "body" | "wellness";
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
// use-merged-metrics builds the Physique series from the measurement log and
// the Wellness series from the client's daily log; the trend semantics live in
// utils/metric-shaping and utils/metric-derived-stats.
export const BODY_METRIC_DEFINITIONS: MetricDefinition<MeasurementKey>[] = [
  { id: "weight", name: "Weight", category: "body", getUnit: (v) => (v === "imperial" ? "lbs" : "kg"), convert: "weight" },
  { id: "bodyFat", name: "Body Fat", category: "body", getUnit: () => "%" },
  { id: "waist", name: "Waist", category: "body", getUnit: (v) => (v === "imperial" ? "in" : "cm"), convert: "length" },
  { id: "hips", name: "Hips", category: "body", getUnit: (v) => (v === "imperial" ? "in" : "cm"), convert: "length" },
  { id: "chest", name: "Chest", category: "body", getUnit: (v) => (v === "imperial" ? "in" : "cm"), convert: "length" },
  { id: "arms", name: "Arms", category: "body", getUnit: (v) => (v === "imperial" ? "in" : "cm"), convert: "length" },
  { id: "thighs", name: "Thighs", category: "body", getUnit: (v) => (v === "imperial" ? "in" : "cm"), convert: "length" },
];

export const WELLNESS_METRIC_DEFINITIONS: MetricDefinition<WellnessKey>[] = [
  { id: "mood", name: "Mood", category: "wellness", getUnit: () => "/5", domain: [1, 5] },
  { id: "energy", name: "Energy", category: "wellness", getUnit: () => "/10", domain: [1, 10] },
  { id: "sleep", name: "Sleep", category: "wellness", getUnit: () => "/10", domain: [1, 10] },
  { id: "stress", name: "Stress", category: "wellness", getUnit: () => "/10", domain: [1, 10] },
  { id: "soreness", name: "Soreness", category: "wellness", getUnit: () => "/10", domain: [1, 10] },
];

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  ...BODY_METRIC_DEFINITIONS,
  ...WELLNESS_METRIC_DEFINITIONS,
];
