import type { CheckIn } from "@/types/check-in";
import type { UnitSystem } from "@/utils/unit-conversions";
import type { MeasurementKey } from "@/lib/measurements/keys";

// Retained for the shared MetricChartCard (also consumed by the client portal's
// metrics-hub).
export type DateRangeFilter = "7d" | "30d" | "90d" | "all";

type MetricDefinitionBase = {
  id: string;
  name: string;
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

/**
 * A PHYSIQUE metric. Its series is the measurement log's day-values, read
 * through the series route, so it names no check-in field: a check-in owns no
 * measurement column — its readings are log rows stamped with its id.
 */
export type BodyMetricDefinition = MetricDefinitionBase & {
  id: MeasurementKey;
  category: "body";
};

/**
 * A WELLNESS metric. Its series is the merge of the check-ins' weekly averages
 * — `key` names the CheckIn field — with the coach's client_metric_entries
 * (owner decision D2: wellness keeps its own model).
 */
export type WellnessMetricDefinition = MetricDefinitionBase & {
  key: keyof CheckIn;
  category: "wellness";
};

export type MetricDefinition = BodyMetricDefinition | WellnessMetricDefinition;

// The coach metric catalog — the single source for metric ids/names/units.
// use-merged-metrics builds the Physique series from the log and the Wellness
// series through utils/metric-points; the trend semantics live in
// utils/metric-shaping and utils/metric-derived-stats.
export const BODY_METRIC_DEFINITIONS: BodyMetricDefinition[] = [
  { id: "weight", name: "Weight", category: "body", getUnit: (v) => (v === "imperial" ? "lbs" : "kg"), convert: "weight" },
  { id: "bodyFat", name: "Body Fat", category: "body", getUnit: () => "%" },
  { id: "waist", name: "Waist", category: "body", getUnit: (v) => (v === "imperial" ? "in" : "cm"), convert: "length" },
  { id: "hips", name: "Hips", category: "body", getUnit: (v) => (v === "imperial" ? "in" : "cm"), convert: "length" },
  { id: "chest", name: "Chest", category: "body", getUnit: (v) => (v === "imperial" ? "in" : "cm"), convert: "length" },
  { id: "arms", name: "Arms", category: "body", getUnit: (v) => (v === "imperial" ? "in" : "cm"), convert: "length" },
  { id: "thighs", name: "Thighs", category: "body", getUnit: (v) => (v === "imperial" ? "in" : "cm"), convert: "length" },
];

export const WELLNESS_METRIC_DEFINITIONS: WellnessMetricDefinition[] = [
  { id: "mood", name: "Mood", key: "mood", category: "wellness", getUnit: () => "/5", domain: [1, 5] },
  { id: "energy", name: "Energy", key: "energy", category: "wellness", getUnit: () => "/10", domain: [1, 10] },
  { id: "sleep", name: "Sleep", key: "sleep", category: "wellness", getUnit: () => "/10", domain: [1, 10] },
  { id: "stress", name: "Stress", key: "stress", category: "wellness", getUnit: () => "/10", domain: [1, 10] },
  { id: "soreness", name: "Soreness", key: "soreness", category: "wellness", getUnit: () => "/10", domain: [1, 10] },
];

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  ...BODY_METRIC_DEFINITIONS,
  ...WELLNESS_METRIC_DEFINITIONS,
];
