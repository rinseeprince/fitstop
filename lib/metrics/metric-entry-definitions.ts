import {
  GIRTH_LIMB_CM_MAX,
  GIRTH_TORSO_CM_MAX,
  WEIGHT_KG_MAX,
  WEIGHT_KG_MIN,
} from "@/lib/constants";

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

// Value bounds are CANONICAL: weight in kilograms, girths in centimetres
// (docs/UNITS-CANONICALIZATION-PLAN.md). A dialog that collects in the viewer's
// unit must convert BEFORE validating against these — see
// components/clients/metrics/log-measurement-dialog.tsx.
//
// Weight was 20-700 here, a pounds range inherited from
// lib/validations/client-metrics.ts and left unconverted when storage became
// kilograms, so it accepted 699 kg. Girth bounds are unchanged in value: they
// were unit-blind (one range for both inches and centimetres), not wrong for
// centimetres. Wellness scales are unitless (mood 1-5, others 1-10).
export const METRIC_VALUE_RANGES: Record<
  MetricEntryKey,
  { min: number; max: number; integer: boolean }
> = {
  weight: { min: WEIGHT_KG_MIN, max: WEIGHT_KG_MAX, integer: false },
  bodyFat: { min: 3, max: 60, integer: false },
  waist: { min: 1, max: GIRTH_TORSO_CM_MAX, integer: false },
  hips: { min: 1, max: GIRTH_TORSO_CM_MAX, integer: false },
  chest: { min: 1, max: GIRTH_TORSO_CM_MAX, integer: false },
  arms: { min: 1, max: GIRTH_LIMB_CM_MAX, integer: false },
  thighs: { min: 1, max: GIRTH_LIMB_CM_MAX, integer: false },
  mood: { min: 1, max: 5, integer: true },
  energy: { min: 1, max: 10, integer: true },
  sleep: { min: 1, max: 10, integer: true },
  stress: { min: 1, max: 10, integer: true },
  soreness: { min: 1, max: 10, integer: true },
};

/**
 * How a typed value becomes storage for each metric.
 *
 * The Metrics page has always LABELLED its inputs in the viewer's unit
 * (use-merged-metrics reads `def.getUnit(preference)`), but the log dialog sent
 * the typed number straight through — so an imperial coach entering 180 lbs
 * stored 180 kilograms, under a label that said "lbs" and a chart that read it
 * back as kg. The label was right and the write was wrong.
 *
 * `null` means unitless: body-fat percent and the 1-5/1-10 wellness scales
 * convert for nobody.
 */
export const METRIC_ENTRY_CONVERSION: Record<
  MetricEntryKey,
  "weight" | "length" | null
> = {
  weight: "weight",
  bodyFat: null,
  waist: "length",
  hips: "length",
  chest: "length",
  arms: "length",
  thighs: "length",
  mood: null,
  energy: null,
  sleep: null,
  stress: null,
  soreness: null,
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
