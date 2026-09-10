"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import {
  computeAbsoluteSeed,
  type ResolvedSelectedDay,
  type RangeEditPayload,
} from "@/utils/nutrition-range-edit-model";
import {
  DEFAULT_SPLIT,
  gramsToSplit,
  splitToGrams,
  type MacroBalanceValue,
} from "@/lib/nutrition/macro-balance";

/**
 * All transient form state for the Edit-targets dialog, seeded from the
 * resolved selection on the open rising edge. The seed comes from the pure
 * model in utils/nutrition-range-edit-model.ts; the arithmetic is the macro
 * balancer's kernel.
 */
export function useEditTargetsForm(open: boolean, days: ResolvedSelectedDay[]) {
  // The dialog IS the macro balancer: one calorie target and one split, the
  // grams derived — and every selected day gets the same four numbers.
  const [balance, setBalance] = useState<MacroBalanceValue>({
    calories: null,
    split: DEFAULT_SPLIT,
  });
  const [note, setNote] = useState("");

  const seed = useMemo(() => computeAbsoluteSeed(days), [days]);
  const singleDay = days.length === 1;

  // Seed ONCE per open, on the rising edge (selection is final by then: grid
  // clicks are behind the overlay; the week-rail path replaces the selection
  // first). The ref guard matters: `days`/`seed` change identity on any SWR
  // revalidation (reconnect, a training writer's fire-and-forget invalidate),
  // and re-seeding mid-edit would silently wipe the coach's values — same
  // guard as the placed-session editor's seededForRef.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!open) {
      seededRef.current = false;
      return;
    }
    if (seededRef.current) return;
    seededRef.current = true;
    setBalance({
      calories: seed.calories,
      split: seed.grams ? gramsToSplit(seed.grams) : DEFAULT_SPLIT,
    });
    setNote(singleDay ? (days[0]?.event.note ?? "") : "");
  }, [open, seed, singleDay, days]);

  const valid = balance.calories != null && balance.calories > 0;

  // D-B note semantics (unchanged from the dialog): single-day edits are
  // authoritative ("" clears); multi-day edits send a note only when typed.
  const noteValue = singleDay ? note : note.trim() !== "" ? note : undefined;

  function buildPayload(): RangeEditPayload | null {
    if (!valid) return null;
    const calories = balance.calories!;
    const grams = splitToGrams(calories, balance.split);
    const payload: RangeEditPayload = {
      mode: "absolute",
      calories,
      proteinG: grams.proteinG,
      carbG: grams.carbG,
      fatG: grams.fatG,
    };
    if (noteValue !== undefined) payload.note = noteValue;
    return payload;
  }

  return {
    balance,
    setBalance,
    seed,
    note,
    setNote,
    singleDay,
    valid,
    buildPayload,
  };
}
