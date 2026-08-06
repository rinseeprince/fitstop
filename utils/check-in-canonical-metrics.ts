import { lbsToKg, inToCm } from "@/utils/unit-conversions";

/**
 * Normalize a submitted check-in payload to canonical kilograms/centimetres.
 *
 * The check-in form still collects in the unit its own toggle showed — Phase 4
 * of docs/UNITS-CANONICALIZATION-PLAN.md moves it to the viewer preference.
 * Storage is canonical (migration 141), so every submission route runs its body
 * through here FIRST and hands the result to both `submitCheckIn` and
 * `updateClientMetricsFromCheckIn`; neither may see a display unit.
 *
 * The unset-toggle fallback for weight is 'kg', NOT the 'lbs' it used to be.
 * components/check-in/step-metrics.tsx:81 highlights **kg** when the toggle is
 * untouched while app/api/client/check-ins/route.ts stored `?? "lbs"` — so an
 * untouched form recorded a kg number as pounds. That mismatch is what left 51
 * rows on Dev tagged lbs over kg values. Girths keep the 'in' fallback, where
 * the toggle and the default have always agreed.
 *
 * `exerciseHighlights[].weightValue` is normalized too, and must be: it lands in
 * `check_in_exercise_highlights.weight_value`, which migration 141 converted and
 * commented 'Kilograms, always'. Each highlight carries its own tag, set from
 * the same check-in toggle (components/check-in/exercise-highlights-section.tsx:73,
 * whose field is labelled `Weight ({weightUnit})` at :226), so it converts on its
 * own tag and falls back to the payload's.
 */
export function toCanonicalCheckInMetrics<
  T extends {
    weight?: number;
    weightUnit?: "lbs" | "kg";
    waist?: number;
    hips?: number;
    chest?: number;
    arms?: number;
    thighs?: number;
    measurementUnit?: "in" | "cm";
    exerciseHighlights?: { weightValue?: number; weightUnit?: "lbs" | "kg" }[];
  },
>(payload: T): T {
  const toCm = (value: number | undefined) =>
    value != null && (payload.measurementUnit ?? "in") === "in"
      ? inToCm(value)
      : value;
  const toKg = (value: number | undefined, tag: "lbs" | "kg" | undefined) =>
    value != null && tag === "lbs" ? lbsToKg(value) : value;

  return {
    ...payload,
    weight: toKg(payload.weight, payload.weightUnit),
    waist: toCm(payload.waist),
    hips: toCm(payload.hips),
    chest: toCm(payload.chest),
    arms: toCm(payload.arms),
    thighs: toCm(payload.thighs),
    exerciseHighlights: payload.exerciseHighlights?.map((h) => ({
      ...h,
      weightValue: toKg(h.weightValue, h.weightUnit ?? payload.weightUnit),
    })),
  };
}
