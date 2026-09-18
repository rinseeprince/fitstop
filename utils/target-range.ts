import { formatEntry, parseEntry, type EntryKind } from "./unit-conversions";
import type { UnitSystem } from "./unit-conversions";

// A numeric target typed as one value or a range — "8-10", "7-8", "70-75" —
// and read back the same way. Every per-set numeric target is stored as a
// min/max pair (utils/exercise-set-specs.ts), so one module owns the string a
// coach types into a range box and the string they read back out; the per-
// column bounds are the caller's. A unit-bearing target — a distance, a
// duration, a pace, a split, a zone — is typed and read in the entry grammar
// (utils/unit-conversions.ts) at each end: `parseEntryRange` and
// `formatEntryRange`, at the bottom of this file.
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

// ---------------------------------------------------------------------------
// A range of unit-bearing entries — "400-800 m", "3:45-3:50 /km", "2:00-2:30",
// "1:52.3-1:55 /500m", "Z2-Z3" — for the builder's distance, duration, pace,
// split and zone boxes. Each end is one entry in the grammar every box speaks
// (CONVENTIONS section 20), in the viewer's units, and the hyphen between them
// is the range grammar above; a tempo is never a range. A plain-number box
// (RPE, RIR, calories …) uses `parseTargetRange`, not this.
// ---------------------------------------------------------------------------

/** The unit an entry can end with, per grammar; a bare number or a clock has none. */
const UNIT_TAILS: Partial<Record<EntryKind, RegExp>> = {
  distance: /\s*(?:m|metres?|meters?|km|kilomet(?:re|er)s?|yd|yards?|mi|miles?)$/i,
  duration: /\s*(?:h|hrs?|hours?|m|mins?|minutes?|s|secs?|seconds?)$/i,
  pace: /\s*\/\s*(?:km|mi|mile)$/i,
  split: /\s*\/\s*500\s*m$/i,
};

const unitTail = (kind: EntryKind, text: string): string | null =>
  UNIT_TAILS[kind]?.exec(text)?.[0] ?? null;

/**
 * The string a unit-bearing range box shows for a stored pair: one entry when
 * the pair collapses, else both ends with a hyphen, the unit written once when
 * both ends share it ("400-800 m", "3:45-3:50 /km") and on each end when they
 * don't ("800 m-1.2 km"). A half-open legacy pair keeps its open side blank.
 */
export function formatEntryRange(
  kind: EntryKind,
  { min, max }: TargetRange,
  viewer: UnitSystem,
): string {
  if (min == null && max == null) return "";
  if (min != null && max != null) {
    const a = formatEntry(kind, min, viewer);
    if (min === max) return a;
    const b = formatEntry(kind, max, viewer);
    const tailA = unitTail(kind, a);
    const tailB = unitTail(kind, b);
    return tailA != null && tailA === tailB ? `${a.slice(0, -tailA.length)}-${b}` : `${a}-${b}`;
  }
  return min != null ? `${formatEntry(kind, min, viewer)}-` : `-${formatEntry(kind, max as number, viewer)}`;
}

/**
 * Parse a unit-bearing value or range, or `null` when it is not one — the
 * caller reverts the box and writes nothing. Each end is read by `parseEntry`
 * in the viewer's units; a unit written once, on the right end, reads for
 * both ("400-800 m", "45-60s", "3:45-3:50 /mi"). A reversed range is ordered,
 * an empty string is an empty range, and each end is clamped into the
 * column's bounds in canonical units.
 */
export function parseEntryRange(
  kind: EntryKind,
  raw: string,
  viewer: UnitSystem,
  bounds: TargetRangeBounds,
): TargetRange | null {
  const text = raw.trim().replace(/[‒–—―]/g, "-");
  if (text === "") return { min: null, max: null };
  const parts = text.split(/\s*-\s*/);
  if (parts.length > 2) return null;

  const read = (end: string): number | null | false => {
    if (end === "") return null;
    const value = parseEntry(kind, end, viewer);
    return typeof value === "number" ? clampTarget(value, bounds) : false;
  };

  if (parts.length === 1) {
    const value = read(parts[0]);
    return value === false || value === null ? null : { min: value, max: value };
  }

  const [first, right] = parts;
  if (first === "" && right === "") return null;
  const tail = unitTail(kind, right);
  const left = tail && first !== "" && unitTail(kind, first) == null ? `${first}${tail}` : first;
  const min = read(left);
  const max = read(right);
  if (min === false || max === false) return null;
  if (min != null && max != null && min > max) return { min: max, max: min };
  return { min, max };
}
