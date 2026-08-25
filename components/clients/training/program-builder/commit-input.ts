import { kgToLbs, lbsToKg, type UnitSystem } from "@/utils/unit-conversions";

/**
 * Blur-commit helpers for the builder's uncontrolled number inputs.
 *
 * Lifted out of set-row-editor.tsx (which had the `int?` superset) so
 * drop-set-editor.tsx stops carrying a near-identical private copy, and so the
 * load-specific guard below exists exactly once.
 */

/**
 * Plain clamp-and-normalize. Correct for reps, RPE, rest and percentage loads —
 * anything with no unit conversion, where a blur that writes the same value back
 * is genuinely a no-op.
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

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * The string an absolute load is SEEDED with, in the viewer's unit.
 *
 * Deliberately NOT `formatLoad`. formatLoad snaps an imperial conversion to the
 * nearest 5 lb, which is right for a read-only readout and catastrophic for an
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
): string =>
  valueKg == null
    ? ""
    : String(round1(viewer === "imperial" ? kgToLbs(valueKg) : valueKg));

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
