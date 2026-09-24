import {
  GIRTH_LIMB_CM_MAX,
  GIRTH_TORSO_CM_MAX,
  WEIGHT_KG_MAX,
  WEIGHT_KG_MIN,
} from "@/lib/constants";
import type { MeasurementKey } from "./keys";

/**
 * What a body measurement's value may be, and how a typed value becomes
 * storage — keyed like `MEASUREMENT_KEYS` (`keys.ts`). Isomorphic: the zod
 * schema, the edit service and the Journey's two reading dialogs read them.
 */

// Value bounds are CANONICAL: weight in kilograms, girths in centimetres
// (CONVENTIONS.md §20 Units). A dialog that collects in the viewer's
// unit must convert BEFORE validating against these — see
// components/clients/metrics/log-measurement-dialog.tsx.
//
// The weight bound was once 20-700, a pounds range inherited from
// lib/validations/client-metrics.ts and left unconverted when storage became
// kilograms, so it accepted 699 kg. Girth bounds are unchanged in value: they
// were unit-blind (one range for both inches and centimetres), not wrong for
// centimetres.
export const MEASUREMENT_VALUE_RANGES: Record<MeasurementKey, { min: number; max: number }> = {
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
export const MEASUREMENT_CONVERSION: Record<MeasurementKey, "weight" | "length" | null> = {
  weight: "weight",
  bodyFat: null,
  waist: "length",
  hips: "length",
  chest: "length",
  arms: "length",
  thighs: "length",
};
