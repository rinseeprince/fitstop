import {
  GIRTH_LIMB_CM_MAX,
  GIRTH_TORSO_CM_MAX,
  WEIGHT_KG_MAX,
  WEIGHT_KG_MIN,
} from "@/lib/constants";
import { MEASUREMENT_KEYS, type MeasurementKey } from "@/lib/measurements/keys";
import type { WellnessKey } from "@/lib/wellness/keys";

// Canonical constants for the coach's Log-measurement entries. Isomorphic:
// imported by the zod schema (server), the service, and the Metrics-page UI.
// The dialog's keys ARE the measurement log's seven keys (one definition, in
// lockstep with migration 158's CHECK): a coach logs body measurements, never
// a wellness score, which is the client's own report. METRIC_ENTRY_KEYS must
// match the BODY_METRIC_DEFINITIONS ids
// (components/clients/metrics/hooks/use-metrics-data.ts).

export const METRIC_ENTRY_KEYS = MEASUREMENT_KEYS;

export type MetricEntryKey = MeasurementKey;

// Value bounds are CANONICAL: weight in kilograms, girths in centimetres
// (CONVENTIONS.md §20 Units). A dialog that collects in the viewer's
// unit must convert BEFORE validating against these — see
// components/clients/metrics/log-measurement-dialog.tsx.
//
// Weight was 20-700 here, a pounds range inherited from
// lib/validations/client-metrics.ts and left unconverted when storage became
// kilograms, so it accepted 699 kg. Girth bounds are unchanged in value: they
// were unit-blind (one range for both inches and centimetres), not wrong for
// centimetres.
export const METRIC_VALUE_RANGES: Record<MetricEntryKey, { min: number; max: number }> = {
  weight: { min: WEIGHT_KG_MIN, max: WEIGHT_KG_MAX },
  bodyFat: { min: 3, max: 60 },
  waist: { min: 1, max: GIRTH_TORSO_CM_MAX },
  hips: { min: 1, max: GIRTH_TORSO_CM_MAX },
  chest: { min: 1, max: GIRTH_TORSO_CM_MAX },
  arms: { min: 1, max: GIRTH_LIMB_CM_MAX },
  thighs: { min: 1, max: GIRTH_LIMB_CM_MAX },
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
 * `null` means unitless: a body-fat percent converts for nobody.
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
};

// The metric's good direction on the Journey: a falling value reads as
// improvement for these (the body metrics, plus the shared chart's
// stress/soreness inversion).
export const DOWN_IS_GOOD: ReadonlySet<MeasurementKey | WellnessKey> = new Set<
  MeasurementKey | WellnessKey
>(["weight", "bodyFat", "waist", "hips", "chest", "arms", "thighs", "stress", "soreness"]);
