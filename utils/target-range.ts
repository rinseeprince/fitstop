// A numeric target typed as one value or a range — "8-10", "7-8", "70-75" —
// and read back the same way. Every per-set numeric target is stored as a
// min/max pair (utils/exercise-set-specs.ts), so one module owns the string a
// coach types into a range box and the string they read back out; the per-
// column bounds are the caller's.
//
// Total by design. A half-open range (min with no max, or the reverse) is
// storable and must round-trip, even though no box authors one: a probe of
// every authored spec on 2026-08-24 found ZERO half-open ranges, and the
// editor reverts a blanked field rather than writing null. Formatting those as
// "8-" / "-12" keeps a legacy row editable instead of silently rewriting it
// the first time someone tabs through the field.

export type TargetRange = {
  min: number | null;
  max: number | null;
};

export type TargetRangeBounds = {
  floor: number;
  ceiling: number;
  /** Whole numbers only (reps, cadence, watts); a decimal is rounded. */
  integer?: boolean;
};

const NUMBER = "(\\d{1,7}(?:\\.\\d{1,2})?)";
const SINGLE = new RegExp(`^${NUMBER}$`);
const BOTH = new RegExp(`^${NUMBER}\\s*-\\s*${NUMBER}$`);
const MIN_ONLY = new RegExp(`^${NUMBER}\\s*-$`);
const MAX_ONLY = new RegExp(`^-\\s*${NUMBER}$`);

/** Clamp into the bounds; whole numbers where the column wants them. */
export function clampTarget(n: number, bounds: TargetRangeBounds): number {
  const clamped = Math.min(bounds.ceiling, Math.max(bounds.floor, n));
  return bounds.integer ? Math.round(clamped) : clamped;
}

/**
 * The string shown in a range box for a stored pair: one number when the pair
 * collapses (min === max), else "min-max" with an ASCII hyphen, the form the
 * coach types.
 */
export function formatTargetRange({ min, max }: TargetRange): string {
  if (min == null && max == null) return "";
  if (min != null && max != null) {
    return min === max ? String(min) : `${min}-${max}`;
  }
  return min != null ? `${min}-` : `-${max}`;
}

/**
 * A stored pair as a readout — "7–8" with an en dash, "7" when the pair
 * collapses, "8+" for a floor alone, "≤12" for a ceiling alone. Null when
 * nothing is prescribed, so a caller can leave the cell empty.
 */
export function formatTargetReadout({ min, max }: TargetRange): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null) {
    return min === max ? String(min) : `${min}–${max}`;
  }
  return min != null ? `${min}+` : `≤${max}`;
}

/**
 * Parse what the coach typed, or `null` when it is not a value or a range.
 *
 * `null` is a REJECTION, not an empty range — the caller reverts the input to
 * its seeded string and writes nothing, so a typo can never blank a
 * prescription. An empty string is a real value (both bounds null) and parses
 * to a range, not a rejection.
 *
 * En/em dashes are accepted because coaches paste from their own notes; output
 * is always the ASCII hyphen. A reversed range ("12-8") is ordered rather than
 * rejected — the intent is unambiguous and refusing it would only make the
 * coach retype it. Each end is clamped into the column's bounds, so a typed 0
 * on a 1–10 column becomes 1.
 */
export function parseTargetRange(
  raw: string,
  bounds: TargetRangeBounds,
): TargetRange | null {
  const text = raw.trim().replace(/[‒–—―]/g, "-");
  if (text === "") return { min: null, max: null };

  const single = SINGLE.exec(text);
  if (single) {
    const n = clampTarget(Number(single[1]), bounds);
    return { min: n, max: n };
  }

  const both = BOTH.exec(text);
  if (both) {
    const a = clampTarget(Number(both[1]), bounds);
    const b = clampTarget(Number(both[2]), bounds);
    return a <= b ? { min: a, max: b } : { min: b, max: a };
  }

  const minOnly = MIN_ONLY.exec(text);
  if (minOnly) return { min: clampTarget(Number(minOnly[1]), bounds), max: null };

  const maxOnly = MAX_ONLY.exec(text);
  if (maxOnly) return { min: null, max: clampTarget(Number(maxOnly[1]), bounds) };

  return null;
}
