import { LOAD_KG_MAX } from "@/lib/constants";
import { isTempo } from "@/utils/exercise-set-specs";
import {
  formatLoadEntry,
  kgToLbs,
  lbsToKg,
  type EntryKind,
  type UnitSystem,
} from "@/utils/unit-conversions";
import {
  formatEntryRange,
  formatTargetRange,
  parseEntryRange,
  parseTargetRange,
  type TargetRange,
  type TargetRangeBounds,
} from "@/utils/target-range";

/**
 * Blur-commit helpers for the builder's uncontrolled inputs.
 *
 * Lifted out of set-row-editor.tsx (which had the `int?` superset) so
 * drop-set-editor.tsx stops carrying a near-identical private copy, and so the
 * load-specific guard below exists exactly once.
 */

/**
 * Plain clamp-and-normalize for a single number. Correct for a drop's reps or
 * load and for rest — anything with no unit conversion, where a blur that
 * writes the same value back is genuinely a no-op.
 */
export const commitNum = (
  e: React.FocusEvent<HTMLInputElement>,
  opts: { min: number; max: number; int?: boolean },
): number | null => {
  const t = e.target.value.trim();
  let result: number | null = null;
  if (t) {
    const n = Number(t);
    if (Number.isFinite(n)) {
      const clamped = Math.min(opts.max, Math.max(opts.min, n));
      result = opts.int ? Math.round(clamped) : clamped;
    }
  }
  e.target.value = result == null ? "" : String(result);
  return result;
};

type RangeCommit =
  | { changed: false }
  | { changed: true; range: TargetRange };

/**
 * Commit a range box — "7-8", "70-75", "8-12" — typed in the unit it stores.
 *
 * Guarded on the SEEDED STRING: a blur that changed nothing writes nothing, or
 * tabbing through a row dirties the draft. A string that is not a value or a
 * range is reverted rather than blanking a prescription on a typo. Each end is
 * clamped into the column's bounds (a typed 0 on a 1–10 column becomes 1).
 */
export const commitRange = (
  e: React.FocusEvent<HTMLInputElement>,
  stored: TargetRange,
  bounds: TargetRangeBounds,
): RangeCommit => {
  const seeded = formatTargetRange(stored);
  const typed = e.target.value.trim();
  if (typed === seeded) return { changed: false };
  const parsed = parseTargetRange(typed, bounds);
  if (parsed === null) {
    e.target.value = seeded;
    return { changed: false };
  }
  e.target.value = formatTargetRange(parsed);
  return { changed: true, range: parsed };
};

/**
 * Commit a unit-bearing range box — "400-800 m", "3:45-3:50 /km", "2:00-2:30",
 * "Z2-Z3" — typed in the viewer's units and stored canonically, behind the
 * same seeded-string guard as `commitRange`. Each end is read by the entry
 * grammar and clamped into the column's bounds in canonical units; a string
 * that is not a value or a range is reverted rather than blanking a target.
 */
export const commitEntryRange = (
  e: React.FocusEvent<HTMLInputElement>,
  stored: TargetRange,
  kind: EntryKind,
  viewer: UnitSystem,
  bounds: TargetRangeBounds,
): RangeCommit => {
  const seeded = formatEntryRange(kind, stored, viewer);
  const typed = e.target.value.trim();
  if (typed === seeded) return { changed: false };
  const parsed = parseEntryRange(kind, typed, viewer, bounds);
  if (parsed === null) {
    e.target.value = seeded;
    return { changed: false };
  }
  e.target.value = formatEntryRange(kind, parsed, viewer);
  return { changed: true, range: parsed };
};

type TempoCommit = { changed: false } | { changed: true; tempo: string | null };

/**
 * Commit a tempo box: four phases, seconds or X for explosive, "3-1-X-0"
 * (`TEMPO_PATTERN`). A lower-case x is read as X; anything else that isn't a
 * tempo is reverted; an emptied box clears the tempo.
 */
export const commitTempo = (
  e: React.FocusEvent<HTMLInputElement>,
  stored: string | null | undefined,
): TempoCommit => {
  const seeded = stored ?? "";
  const typed = e.target.value.trim().toUpperCase();
  if (typed === seeded) {
    e.target.value = seeded;
    return { changed: false };
  }
  if (typed !== "" && !isTempo(typed)) {
    e.target.value = seeded;
    return { changed: false };
  }
  e.target.value = typed;
  return { changed: true, tempo: typed === "" ? null : typed };
};

/**
 * The string an absolute load is SEEDED with, in the viewer's unit.
 *
 * Deliberately NOT `formatLoad`. formatLoad snaps an imperial conversion to the
 * nearest 2.5 lb, which is right for a read-only readout and catastrophic for an
 * editable field: the input below writes on every blur, so the snap would
 * round-trip into storage. An imperial coach opening a 100 kg session would see
 * 220, tab past without editing, and store 99.79 kg — per field, on first
 * focus-through, having changed nothing. CONVENTIONS §8 is explicit that a
 * hand-written set_specs value "silently corrupts the coach's programming, and
 * no test will tell you".
 */
export const displayLoad = (
  valueKg: number | null | undefined,
  viewer: UnitSystem,
): string => (valueKg == null ? "" : formatLoadEntry(valueKg, viewer));

const toDisplayNumber = (valueKg: number | null | undefined, viewer: UnitSystem) =>
  valueKg == null ? null : Number(displayLoad(valueKg, viewer));

/** The string an absolute load RANGE is seeded with, in the viewer's unit. */
export const displayLoadRange = (
  minKg: number | null | undefined,
  maxKg: number | null | undefined,
  viewer: UnitSystem,
): string =>
  formatTargetRange({
    min: toDisplayNumber(minKg, viewer),
    max: toDisplayNumber(maxKg, viewer),
  });

type LoadCommit =
  | { changed: false }
  | { changed: true; valueKg: number | null };

/**
 * Commit an absolute load typed in the viewer's unit, as canonical kilograms.
 *
 * The guard is the point. Rounding for display is itself lossy — 100 kg shows as
 * "220.5" for an imperial viewer and converts back to 100.017 kg — so a blur
 * that merely passed through the field must not write at all. Comparing the
 * typed string against the seeded string makes a focus-through an exact no-op
 * regardless of rounding, which no epsilon tolerance can promise.
 *
 * Clamping happens in KILOGRAMS, after conversion: the bounds describe storage,
 * not what the coach typed.
 */
export const commitLoad = (
  e: React.FocusEvent<HTMLInputElement>,
  storedKg: number | null | undefined,
  viewer: UnitSystem,
  opts: { min: number; max: number },
): LoadCommit => {
  const seeded = displayLoad(storedKg, viewer);
  const typed = e.target.value.trim();
  if (typed === seeded) return { changed: false };

  let valueKg: number | null = null;
  if (typed) {
    const n = Number(typed);
    if (Number.isFinite(n)) {
      const kg = viewer === "imperial" ? lbsToKg(n) : n;
      valueKg = Math.min(opts.max, Math.max(opts.min, kg));
    }
  }
  e.target.value = displayLoad(valueKg, viewer);
  return { changed: true, valueKg };
};

type LoadRangeCommit =
  | { changed: false }
  | { changed: true; minKg: number | null; maxKg: number | null };

/**
 * Commit an absolute load RANGE — "100-105" in the viewer's unit — as canonical
 * kilograms at both ends, behind the same seeded-string guard as `commitLoad`.
 * The typed numbers are bounded in the viewer's unit (the kilogram ceiling
 * converted), then each end converts and is clamped in kilograms.
 */
export const commitLoadRange = (
  e: React.FocusEvent<HTMLInputElement>,
  storedMinKg: number | null | undefined,
  storedMaxKg: number | null | undefined,
  viewer: UnitSystem,
): LoadRangeCommit => {
  const seeded = displayLoadRange(storedMinKg, storedMaxKg, viewer);
  const typed = e.target.value.trim();
  if (typed === seeded) return { changed: false };
  const ceiling = viewer === "imperial" ? kgToLbs(LOAD_KG_MAX) : LOAD_KG_MAX;
  const parsed = parseTargetRange(typed, { floor: 0, ceiling, integer: false });
  if (parsed === null) {
    e.target.value = seeded;
    return { changed: false };
  }
  const toKg = (n: number | null) =>
    n == null
      ? null
      : Math.min(LOAD_KG_MAX, Math.max(0, viewer === "imperial" ? lbsToKg(n) : n));
  const minKg = toKg(parsed.min);
  const maxKg = toKg(parsed.max);
  e.target.value = displayLoadRange(minKg, maxKg, viewer);
  return { changed: true, minKg, maxKg };
};
