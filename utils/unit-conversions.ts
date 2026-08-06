import type { UnitPreference } from "@/types/check-in";

/**
 * Unit conversion and presentation-boundary formatting.
 *
 * Storage is canonical: every weight is kilograms, every length is centimetres
 * (docs/UNITS-CANONICALIZATION-PLAN.md). Nothing between the database and the
 * render layer knows about lbs or inches — these helpers are that boundary, so
 * a formatter takes the stored value plus the VIEWER's preference and there is
 * no per-record unit to pass.
 *
 * `KG_PER_LB` and `CM_PER_IN` are the only unit-conversion factors in this
 * file, deliberately: the codebase previously held four conflicting lbs↔kg
 * constants (2.205, 2.20462, 0.453592, and /2.205 inside SQL).
 * `INCHES_PER_FOOT` and `IMPERIAL_LOAD_INCREMENT_LB` are not conversion
 * factors — one is composite-unit arithmetic, the other a plate increment.
 *
 * Formatters return numbers, never pre-formatted strings: callers own display
 * rounding. The one exception is `formatHeight`, which must round to whole
 * inches itself in order to carry 12 inches into the next foot.
 *
 * NAME COLLISION, until Phase 3 deletes the older one: `utils/nutrition-helpers.ts`
 * also exports a `formatWeight`, with a different signature and a string return
 * (`formatWeight(weight, unitPreference): string`). Editor auto-import will
 * offer both. This module's is the canonical-storage one.
 */

/**
 * The viewer's unit system. Structurally the same union as `UnitPreference`,
 * aliased rather than redeclared so the two can never drift; `UnitPreference`
 * stays the declaration site because `utils/ → types/` is this repo's existing
 * dependency direction.
 */
export type UnitSystem = UnitPreference;

/**
 * What an unresolved viewer is shown. Metric deliberately — the legacy
 * `clients.unit_preference` / `clients.weight_unit` defaults are imperial and
 * are backwards for this platform (migration 140's header records why).
 *
 * Declared here rather than beside the server resolver so the client bundle can
 * import it without pulling in `supabaseAdmin`.
 */
export const DEFAULT_UNIT_SYSTEM: UnitSystem = "metric";

/** Exact, by definition of the international pound. */
export const KG_PER_LB = 0.45359237;
/** Exact, by definition of the international inch. */
export const CM_PER_IN = 2.54;

/**
 * Smallest increment loadable on a barbell in an imperial gym. Only used by
 * `formatLoad` — see its note on why loads snap and body weights do not.
 */
const IMPERIAL_LOAD_INCREMENT_LB = 5;

/** Composite-unit arithmetic for imperial height, not a conversion factor. */
const INCHES_PER_FOOT = 12;

export type WeightDisplay = { value: number; unit: "kg" | "lbs" };
export type LengthDisplay = { value: number; unit: "cm" | "in" };
export type HeightDisplay =
  | { system: "metric"; value: number; unit: "cm" }
  | { system: "imperial"; feet: number; inches: number };

export function lbsToKg(lbs: number): number {
  return lbs * KG_PER_LB;
}

export function kgToLbs(kg: number): number {
  return kg / KG_PER_LB;
}

export function inToCm(inches: number): number {
  return inches * CM_PER_IN;
}

export function cmToIn(cm: number): number {
  return cm / CM_PER_IN;
}

/**
 * Body weight, goal weight, weight change — converts freely, never snaps.
 * A metric viewer gets the stored kilograms back unchanged.
 */
export function formatWeight(valueKg: number, viewer: UnitSystem): WeightDisplay {
  return viewer === "imperial"
    ? { value: kgToLbs(valueKg), unit: "lbs" }
    : { value: valueKg, unit: "kg" };
}

/**
 * Girth measurements (waist, hips, chest, arms, thighs). Decimal inches are
 * correct here — unlike height, which is composite. See `formatHeight`.
 */
export function formatLength(valueCm: number, viewer: UnitSystem): LengthDisplay {
  return viewer === "imperial"
    ? { value: cmToIn(valueCm), unit: "in" }
    : { value: valueCm, unit: "cm" };
}

/**
 * Prescribed or logged barbell load — a distinct helper from `formatWeight`,
 * not an option on it.
 *
 * Body weight converts cleanly in both directions; a barbell does not. Convert
 * a prescribed 100 kg faithfully and an imperial gym sees 220.5 lbs, which
 * cannot be loaded — they will put 220 on the bar. A precise-looking
 * unloadable number is worse than no conversion at all, so an imperial viewer
 * gets the conversion snapped to the nearest 5 lb.
 *
 * DELIBERATE DEVIATION from docs/UNITS-CANONICALIZATION-PLAN.md:429, which
 * also specifies a 2.5 kg snap for metric viewers. Metric is the IDENTITY path:
 * no conversion happens, so snapping there does not round a conversion artefact,
 * it rewrites stored data at the display layer — a client's logged 47 kg would
 * render as 47.5, an Epley e1RM of 102.3 as 102.5, and a session volume total
 * of 12,347 as 12,347.5. Metric is therefore pass-through. Signed off by the
 * product owner 2026-08-06.
 *
 * The loadable increment is really a property of the client's gym rather than
 * of the viewer's preference; modelling gym-unit separately is out of scope and
 * snapping to the viewer's system is right in the overwhelming majority of cases.
 */
export function formatLoad(valueKg: number, viewer: UnitSystem): WeightDisplay {
  if (viewer !== "imperial") return { value: valueKg, unit: "kg" };

  // 5 is exactly representable in binary floating point and the quotient is
  // rounded to an integer first, so the product carries no float dust.
  const lbs = kgToLbs(valueKg);
  const snapped =
    Math.round(lbs / IMPERIAL_LOAD_INCREMENT_LB) * IMPERIAL_LOAD_INCREMENT_LB;
  return { value: snapped, unit: "lbs" };
}

/**
 * Height, which is composite in imperial — 5'11", never "71 in". Hence the
 * discriminated union rather than `{ value, unit }`.
 *
 * This is the one formatter that rounds, because it must: the carry from 12
 * inches into the next foot cannot be done at the call site after the fact
 * (rounding 11.988 in at the call site yields 5'12").
 */
export function formatHeight(valueCm: number, viewer: UnitSystem): HeightDisplay {
  if (viewer !== "imperial") {
    return { system: "metric", value: valueCm, unit: "cm" };
  }

  const totalInches = cmToIn(valueCm);
  let feet = Math.floor(totalInches / INCHES_PER_FOOT);
  let inches = Math.round(totalInches - feet * INCHES_PER_FOOT);

  if (inches === INCHES_PER_FOOT) {
    feet += 1;
    inches = 0;
  }

  return { system: "imperial", feet, inches };
}

/**
 * Request-payload value + the unit tag that payload carried → canonical storage.
 *
 * Distinct from `parseWeightToKg`/`parseLengthToCm`, which take the VIEWER's
 * preference: these take the `"lbs" | "kg"` / `"in" | "cm"` tag that a form
 * still sends on the wire until Phase 4 moves those forms onto the viewer
 * preference. Write paths use these; render paths never do.
 *
 * `undefined` in, `undefined` out, so a caller can pass an absent optional field
 * straight through without a null dance.
 */
export function toCanonicalWeightKg(
  value: number | undefined,
  tag: "lbs" | "kg" | undefined
): number | undefined {
  return value != null && tag === "lbs" ? lbsToKg(value) : value;
}

export function toCanonicalLengthCm(
  value: number | undefined,
  tag: "in" | "cm" | undefined
): number | undefined {
  return value != null && tag === "in" ? inToCm(value) : value;
}

/** Form input in the viewer's unit → canonical kilograms for storage. */
export function parseWeightToKg(input: number, viewer: UnitSystem): number {
  return viewer === "imperial" ? lbsToKg(input) : input;
}

/** Form input in the viewer's unit → canonical centimetres for storage. */
export function parseLengthToCm(input: number, viewer: UnitSystem): number {
  return viewer === "imperial" ? inToCm(input) : input;
}

/**
 * Height input → canonical centimetres. Takes the shape the form collected
 * rather than a viewer preference, because an imperial height input is two
 * fields (feet + inches) and a metric one is a single centimetre field.
 */
export function parseHeightToCm(
  input: { cm: number } | { feet: number; inches: number }
): number {
  if ("cm" in input) return input.cm;
  return inToCm(input.feet * INCHES_PER_FOOT + input.inches);
}

/**
 * Normalize a stored `unit_preference` column into the union.
 *
 * `null` is legitimate — `clients.unit_preference` is nullable (migration 011)
 * — and defaults quietly to metric. Any other unexpected value means the CHECK
 * constraint was bypassed or the column changed meaning, so it warns rather
 * than defaulting in silence.
 */
export function toUnitSystem(value: string | null | undefined): UnitSystem {
  if (value === "imperial") return "imperial";
  if (value === "metric") return "metric";
  if (value != null) {
    console.warn(
      "[units] Unexpected unit_preference value, defaulting to metric:",
      value
    );
  }
  return "metric";
}
