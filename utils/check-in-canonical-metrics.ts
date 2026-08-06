import {
  lbsToKg,
  inToCm,
  parseLengthToCm,
  parseWeightToKg,
  type UnitSystem,
} from "@/utils/unit-conversions";

/**
 * Check-in metrics → canonical kilograms and centimetres.
 *
 * Two converters, because two different callers need two different questions
 * answered, and conflating them is what produced the original bug:
 *
 * - `toCanonicalCheckInSubmission` runs in the BROWSER, before submit, and
 *   converts from the VIEWER's preference. This is the web form's path.
 * - `toCanonicalCheckInMetrics` runs on the SERVER and converts from the unit
 *   tag the payload carried. It exists for a non-web client (React Native)
 *   that logs in its own unit; for the web it is a no-op, because the form
 *   above has already converted and tagged the payload "kg"/"cm".
 */

/** The unit-bearing slice of a check-in payload, on the wire and in the form. */
export type CheckInMetricPayload = {
  weight?: number;
  weightUnit?: "lbs" | "kg";
  waist?: number;
  hips?: number;
  chest?: number;
  arms?: number;
  thighs?: number;
  measurementUnit?: "in" | "cm";
  exerciseHighlights?: { weightValue?: number; weightUnit?: "lbs" | "kg" }[];
};

/**
 * Server-side: convert on the tag the payload carried.
 *
 * NO FALLBACKS. `submitCheckInSchema` now requires the tag whenever the value
 * it describes is present, so an absent tag is a 400 rather than a guess. That
 * requirement is the whole point: the girth branch here used to read
 * `measurementUnit ?? "in"`, which silently multiplied an untagged centimetre
 * payload by 2.54, while the weight branch only ever converted on an explicit
 * "lbs" — so the two disagreed about what an untagged payload meant. A
 * fallback decides the unit for a payload that never stated one, which is how
 * pounds got stored as kilograms in the first place.
 *
 * `exerciseHighlights[].weightValue` is converted too, and must be: it lands in
 * `check_in_exercise_highlights.weight_value`, which migration 141 converted
 * and commented 'Kilograms, always'. Each highlight carries its own tag (also
 * now required alongside its value), so it no longer falls back to the
 * payload's.
 */
export function toCanonicalCheckInMetrics<T extends CheckInMetricPayload>(
  payload: T
): T {
  const toCm = (value: number | undefined) =>
    value != null && payload.measurementUnit === "in" ? inToCm(value) : value;
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
      weightValue: toKg(h.weightValue, h.weightUnit),
    })),
  };
}

/**
 * Browser-side: convert from the VIEWER's preference and tag the result
 * canonical, so nothing downstream has to guess.
 *
 * The form holds display units while it is being filled in — that is what the
 * client sees and what the "Last: 82.4" comparison line is measured against —
 * and this is the single point where it becomes storage. Converting per
 * keystroke instead would round-trip every number through a rounded display
 * string on every edit.
 *
 * Tags are emitted only alongside a value, matching the schema's conditional
 * requirement: an empty check-in sends neither a number nor a unit.
 */
export function toCanonicalCheckInSubmission<T extends CheckInMetricPayload>(
  form: T,
  viewer: UnitSystem
): T & Pick<CheckInMetricPayload, "weightUnit" | "measurementUnit"> {
  const toKg = (value: number | undefined) =>
    value == null ? undefined : parseWeightToKg(value, viewer);
  const toCm = (value: number | undefined) =>
    value == null ? undefined : parseLengthToCm(value, viewer);

  const hasGirth = [
    form.waist,
    form.hips,
    form.chest,
    form.arms,
    form.thighs,
  ].some((value) => value != null);

  return {
    ...form,
    weight: toKg(form.weight),
    ...(form.weight != null ? { weightUnit: "kg" as const } : {}),
    waist: toCm(form.waist),
    hips: toCm(form.hips),
    chest: toCm(form.chest),
    arms: toCm(form.arms),
    thighs: toCm(form.thighs),
    ...(hasGirth ? { measurementUnit: "cm" as const } : {}),
    ...(form.exerciseHighlights
      ? {
          exerciseHighlights: form.exerciseHighlights.map((h) => ({
            ...h,
            weightValue: toKg(h.weightValue),
            ...(h.weightValue != null ? { weightUnit: "kg" as const } : {}),
          })),
        }
      : {}),
  };
}
