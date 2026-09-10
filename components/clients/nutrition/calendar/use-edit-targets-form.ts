"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { format } from "date-fns";
import { getDeltaBaseCalories } from "@/utils/nutrition-event-helpers";
import {
  computeAbsoluteSeed,
  applyCalorieDelta,
  toInt,
  type ResolvedSelectedDay,
  type RangeEditPayload,
} from "@/utils/nutrition-range-edit-model";
import {
  DEFAULT_SPLIT,
  gramsToSplit,
  splitToGrams,
  type MacroBalanceValue,
} from "@/lib/nutrition/macro-balance";

export type EditTargetsTab = "set" | "adjust";
export type DeltaMode = "kcal" | "percent";

type PreviewRow = {
  date: string;
  /** Mono day label, e.g. "Tue 21". */
  label: string;
  base: number;
  next: number;
  delta: number;
};

/**
 * All transient form state for the Edit-targets sheet, seeded from the
 * resolved selection on the open rising edge. Derivations (the seed, the
 * delta preview) come from the pure model in utils/nutrition-range-edit-model.ts;
 * the Set targets tab's arithmetic is the macro balancer's kernel.
 */
export function useEditTargetsForm(open: boolean, days: ResolvedSelectedDay[]) {
  const [tab, setTab] = useState<EditTargetsTab>("set");
  // Set targets IS the macro balancer: one calorie target and one split, the
  // grams derived — and every selected day gets the same four numbers.
  const [balance, setBalance] = useState<MacroBalanceValue>({
    calories: null,
    split: DEFAULT_SPLIT,
  });
  const [deltaMode, setDeltaMode] = useState<DeltaMode>("kcal");
  const [deltaValue, setDeltaValue] = useState("");
  const [holdProtein, setHoldProtein] = useState(true);
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
    setTab("set");
    setBalance({
      calories: seed.calories,
      split: seed.grams ? gramsToSplit(seed.grams) : DEFAULT_SPLIT,
    });
    setDeltaMode("kcal");
    setDeltaValue("");
    setHoldProtein(true);
    setNote(singleDay ? (days[0]?.event.note ?? "") : "");
  }, [open, seed, singleDay, days]);

  // ---- Set targets derivations ----
  const absoluteValid = balance.calories != null && balance.calories > 0;

  // ---- Adjust by derivations ----
  const deltaInt = toInt(deltaValue);
  const adjustValid = deltaInt != null && deltaInt !== 0;

  const previewRows: PreviewRow[] = useMemo(() => {
    if (deltaInt == null || deltaInt === 0) return [];
    return days.map((d) => {
      const base = getDeltaBaseCalories(d.event);
      const next = applyCalorieDelta(
        base,
        deltaMode === "percent" ? { percent: deltaInt } : { calorieDelta: deltaInt }
      );
      return {
        date: d.date,
        label: format(new Date(d.date + "T00:00:00"), "EEE d"),
        base,
        next,
        delta: next - base,
      };
    });
  }, [days, deltaInt, deltaMode]);

  function stepDelta(step: number) {
    setDeltaValue(String((toInt(deltaValue) ?? 0) + step));
  }

  /** Switching kcal↔% clears the amount — "-200" means something completely
   * different as a percent, so carrying it across would arm a wild payload. */
  function switchDeltaMode(mode: DeltaMode) {
    setDeltaMode(mode);
    setDeltaValue("");
  }

  // ---- Shared ----
  const valid = tab === "set" ? absoluteValid : adjustValid;

  // D-B note semantics (unchanged from the dialog): single-day edits are
  // authoritative ("" clears); multi-day edits send a note only when typed.
  const noteValue = singleDay ? note : note.trim() !== "" ? note : undefined;

  function buildPayload(): RangeEditPayload | null {
    if (!valid) return null;
    if (tab === "set") {
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
    const payload: RangeEditPayload = { mode: "delta" };
    if (deltaMode === "percent") payload.percent = deltaInt!;
    else payload.calorieDelta = deltaInt!;
    // Omit when true — an absent flag keeps the server on its legacy path.
    if (!holdProtein) payload.holdProtein = false;
    if (noteValue !== undefined) payload.note = noteValue;
    return payload;
  }

  return {
    tab,
    setTab,
    // Set targets
    balance,
    setBalance,
    seed,
    // Adjust by
    deltaMode,
    switchDeltaMode,
    deltaValue,
    setDeltaValue,
    stepDelta,
    holdProtein,
    setHoldProtein,
    previewRows,
    // Shared
    note,
    setNote,
    singleDay,
    valid,
    buildPayload,
  };
}
