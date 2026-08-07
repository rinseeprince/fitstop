"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  formatHeight,
  parseHeightToCm,
  parseLengthToCm,
  parseWeightToKg,
  cmToIn,
  kgToLbs,
  type UnitSystem,
} from "@/utils/unit-conversions";

/**
 * Form inputs that COLLECT in the viewer's unit and COMMIT in canonical units.
 *
 * Storage is canonical kilograms/centimetres, so every form that takes a weight
 * or a length has the same three problems, and solving them per-form is how
 * this class of bug keeps coming back:
 *
 * 1. **Display rounding is lossy, so an untouched field must not write.** A
 *    stored 178 cm seeds an imperial viewer as 5'10", which parses back to
 *    177.8. A stored 100 kg seeds as "220.5" and parses back to 100.017. Any
 *    form that re-parses whatever is in the box on submit therefore rewrites
 *    values the user never touched — and it fires on EVERY save, not just one
 *    that edited the field, because the field is pre-populated. `commit` is the
 *    guard: while the box still holds exactly what it was seeded with, it
 *    returns the original canonical number rather than a round-tripped one.
 *
 *    This is the same guard `program-builder/commit-input.ts` applies to
 *    prescribed loads, for the same reason. It is comparison of the SEEDED
 *    STRING, not an epsilon tolerance, because only string equality makes a
 *    focus-through an exact no-op regardless of how the value was rounded.
 *
 * 2. **The digits must not be reinterpreted when the viewer flips units.**
 *    Someone who types 180 cm and switches to imperial means 5'11", not 180
 *    inches. These hooks re-derive the display from the value on a unit change,
 *    and an untouched field stays untouched across the flip.
 *
 * 3. **Bounds describe STORAGE.** Callers validate `commit`, never the typed
 *    string — `lib/constants.ts`'s WEIGHT_KG_MIN/MAX and friends are kilograms
 *    and centimetres.
 *
 * Height is a separate hook rather than a `kind` because imperial height is
 * composite (two fields, 5'11") while a girth is decimal inches.
 */

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** What `commit` returns: the canonical value to store, or null for "blank". */
type Commit = number | null;

// ---------------------------------------------------------------------------
// Single-field: body weight (kg) and girths (cm)
// ---------------------------------------------------------------------------

export type CanonicalInputKind = "weight" | "length";

function toDisplayString(
  canonical: number | null | undefined,
  viewer: UnitSystem,
  kind: CanonicalInputKind,
): string {
  if (canonical == null || !Number.isFinite(canonical)) return "";
  if (viewer !== "imperial") return String(round1(canonical));
  return String(round1(kind === "weight" ? kgToLbs(canonical) : cmToIn(canonical)));
}

function toCanonicalNumber(
  display: string,
  viewer: UnitSystem,
  kind: CanonicalInputKind,
): Commit {
  const trimmed = display.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return kind === "weight"
    ? parseWeightToKg(parsed, viewer)
    : parseLengthToCm(parsed, viewer);
}

export type CanonicalInput = {
  /** The string in the box, in the viewer's unit. */
  value: string;
  setValue: (next: string) => void;
  /** What the box currently means, canonically. null = blank or unparseable. */
  canonical: Commit;
  /** What to STORE: the untouched seed when nothing was edited. See note 1. */
  commit: Commit;
  /** True while the box still holds exactly what it was seeded with. */
  isPristine: boolean;
  /** True when the box has content that does not parse to a usable number. */
  hasParseError: boolean;
  /** Re-seed (a dialog re-opening on a different record). */
  reset: (seed?: number | null) => void;
};

export function useCanonicalInput(
  viewer: UnitSystem,
  seed: number | null | undefined,
  kind: CanonicalInputKind,
): CanonicalInput {
  const [state, setState] = useState(() => ({
    value: toDisplayString(seed, viewer, kind),
    baseline: toDisplayString(seed, viewer, kind),
    seed: seed ?? null,
    viewer,
  }));

  useEffect(() => {
    setState((prev) => {
      if (prev.viewer === viewer) return prev;
      const pristine = prev.value === prev.baseline;
      const carried = pristine
        ? prev.seed
        : toCanonicalNumber(prev.value, prev.viewer, kind);
      const next = toDisplayString(carried, viewer, kind);
      // A dirty field keeps its old-unit baseline, which can never match again
      // — correct, because it IS dirty. A pristine one re-baselines so that
      // flipping units alone is not mistaken for an edit.
      return {
        value: next,
        baseline: pristine ? next : prev.baseline,
        seed: prev.seed,
        viewer,
      };
    });
  }, [viewer, kind]);

  const isPristine = state.value === state.baseline;
  const canonical = toCanonicalNumber(state.value, viewer, kind);

  // Both callbacks are memoized, and that is load-bearing rather than tidiness.
  // A consumer that re-seeds on dialog-open naturally writes
  // `useEffect(..., [open, record, reset])`; if `reset` were a fresh closure
  // each render the effect would re-run every render, and because it setStates
  // a brand-new object that render is guaranteed — an infinite loop that only
  // appears once the hook is mounted inside a component, which is exactly what
  // shipped in client-settings-dialog. See the stability test.
  const setValue = useCallback(
    (next: string) => setState((prev) => ({ ...prev, value: next })),
    [],
  );

  const reset = useCallback(
    (nextSeed?: number | null) =>
      setState({
        value: toDisplayString(nextSeed, viewer, kind),
        baseline: toDisplayString(nextSeed, viewer, kind),
        seed: nextSeed ?? null,
        viewer,
      }),
    [viewer, kind],
  );

  return {
    value: state.value,
    setValue,
    canonical,
    commit: isPristine ? state.seed : canonical,
    isPristine,
    hasParseError: state.value.trim() !== "" && canonical === null,
    reset,
  };
}

// ---------------------------------------------------------------------------
// Composite: height (cm), which is feet + inches for an imperial viewer
// ---------------------------------------------------------------------------

type HeightFields = { cm: string; feet: string; inches: string };

const EMPTY_HEIGHT: HeightFields = { cm: "", feet: "", inches: "" };

function toHeightFields(
  valueCm: number | null | undefined,
  viewer: UnitSystem,
): HeightFields {
  if (valueCm == null || !Number.isFinite(valueCm) || valueCm <= 0) {
    return EMPTY_HEIGHT;
  }
  if (viewer !== "imperial") {
    return { ...EMPTY_HEIGHT, cm: String(round1(valueCm)) };
  }
  const shown = formatHeight(valueCm, "imperial");
  return shown.system === "imperial"
    ? { cm: "", feet: String(shown.feet), inches: String(shown.inches) }
    : EMPTY_HEIGHT;
}

function heightFieldsToCm(fields: HeightFields, viewer: UnitSystem): Commit {
  if (viewer === "imperial") {
    const feetRaw = fields.feet.trim();
    const inchesRaw = fields.inches.trim();
    if (!feetRaw && !inchesRaw) return null;
    const feet = feetRaw ? Number(feetRaw) : 0;
    const inches = inchesRaw ? Number(inchesRaw) : 0;
    if (!Number.isFinite(feet) || !Number.isFinite(inches)) return null;
    if (feet < 0 || inches < 0) return null;
    const cm = parseHeightToCm({ feet, inches });
    return cm > 0 ? cm : null;
  }
  const trimmed = fields.cm.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const sameHeight = (a: HeightFields, b: HeightFields): boolean =>
  a.cm === b.cm && a.feet === b.feet && a.inches === b.inches;

const isHeightBlank = (f: HeightFields): boolean =>
  !f.cm.trim() && !f.feet.trim() && !f.inches.trim();

export type HeightInput = {
  /** "imperial" renders feet + inches; anything else renders one cm field. */
  system: UnitSystem;
  fields: HeightFields;
  setCm: (next: string) => void;
  setFeet: (next: string) => void;
  setInches: (next: string) => void;
  canonicalCm: Commit;
  /** Canonical centimetres to STORE — the untouched seed when nothing changed. */
  commitCm: Commit;
  isPristine: boolean;
  hasParseError: boolean;
  reset: (seedCm?: number | null) => void;
};

export function useHeightInput(
  viewer: UnitSystem,
  seedCm: number | null | undefined,
): HeightInput {
  const [state, setState] = useState(() => ({
    fields: toHeightFields(seedCm, viewer),
    baseline: toHeightFields(seedCm, viewer),
    seed: seedCm ?? null,
    viewer,
  }));

  useEffect(() => {
    setState((prev) => {
      if (prev.viewer === viewer) return prev;
      const pristine = sameHeight(prev.fields, prev.baseline);
      const carried = pristine
        ? prev.seed
        : heightFieldsToCm(prev.fields, prev.viewer);
      const next = toHeightFields(carried, viewer);
      return {
        fields: next,
        baseline: pristine ? next : prev.baseline,
        seed: prev.seed,
        viewer,
      };
    });
  }, [viewer]);

  const isPristine = sameHeight(state.fields, state.baseline);
  const canonicalCm = heightFieldsToCm(state.fields, viewer);

  // Memoized for the same reason as useCanonicalInput's — see the note there.
  const setField = useCallback(
    (key: keyof HeightFields) => (next: string) =>
      setState((prev) => ({ ...prev, fields: { ...prev.fields, [key]: next } })),
    [],
  );
  const setCm = useMemo(() => setField("cm"), [setField]);
  const setFeet = useMemo(() => setField("feet"), [setField]);
  const setInches = useMemo(() => setField("inches"), [setField]);

  const reset = useCallback(
    (nextSeed?: number | null) =>
      setState({
        fields: toHeightFields(nextSeed, viewer),
        baseline: toHeightFields(nextSeed, viewer),
        seed: nextSeed ?? null,
        viewer,
      }),
    [viewer],
  );

  return {
    system: viewer,
    fields: state.fields,
    setCm,
    setFeet,
    setInches,
    canonicalCm,
    commitCm: isPristine ? state.seed : canonicalCm,
    isPristine,
    hasParseError: !isHeightBlank(state.fields) && canonicalCm === null,
    reset,
  };
}
