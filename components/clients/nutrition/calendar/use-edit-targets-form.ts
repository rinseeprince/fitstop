"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { format } from "date-fns";
import { calculateDailyMacros } from "@/utils/nutrition-helpers";
import { getDeltaBaseCalories } from "@/utils/nutrition-event-helpers";
import {
  computeAbsoluteSeed,
  classifyAbsoluteMacros,
  applyCalorieDelta,
  toInt,
  CALORIE_MATCH_TOLERANCE,
  type ResolvedSelectedDay,
  type RangeEditPayload,
} from "@/utils/nutrition-range-edit-model";

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
 * resolved selection on the open rising edge. Derivations (mixed detection,
 * reconcile, preview) come from the pure model in
 * utils/nutrition-range-edit-model.ts.
 */
export function useEditTargetsForm(open: boolean, days: ResolvedSelectedDay[]) {
  const [tab, setTab] = useState<EditTargetsTab>("set");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [deltaMode, setDeltaMode] = useState<DeltaMode>("kcal");
  const [deltaValue, setDeltaValue] = useState("");
  const [holdProtein, setHoldProtein] = useState(true);
  const [note, setNote] = useState("");

  const seed = useMemo(() => computeAbsoluteSeed(days), [days]);
  const singleDay = days.length === 1;

  // Seed ONCE per open, on the rising edge (selection is final by then: grid
  // clicks are behind the overlay; the week-rail path replaces the selection
  // first). The ref guard matters: `days`/`seed` change identity on any SWR
  // revalidation (reconnect, a training cascade's fire-and-forget invalidate),
  // and re-seeding mid-edit would silently wipe the coach's typed values —
  // same guard as the placed-session editor's seededForRef.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!open) {
      seededRef.current = false;
      return;
    }
    if (seededRef.current) return;
    seededRef.current = true;
    setTab("set");
    setCalories(seed.calories.value);
    setProtein(seed.protein.value);
    setCarbs(seed.carbs.value);
    setFat(seed.fat.value);
    setDeltaMode("kcal");
    setDeltaValue("");
    setHoldProtein(true);
    setNote(singleDay ? (days[0]?.event.note ?? "") : "");
  }, [open, seed, singleDay, days]);

  // ---- Set targets derivations ----
  const cal = toInt(calories);
  const p = toInt(protein);
  const c = toInt(carbs);
  const f = toInt(fat);
  const macroState = classifyAbsoluteMacros(protein, carbs, fat);
  const macroCals = (p ?? 0) * 4 + (c ?? 0) * 4 + (f ?? 0) * 9;
  const diff = macroCals - (cal ?? 0);
  const matched = cal != null && cal > 0 && Math.abs(diff) <= CALORIE_MATCH_TOLERANCE;

  const absoluteValid =
    cal != null &&
    cal > 0 &&
    macroState !== "invalid" &&
    (macroState !== "verbatim" || matched);

  /** Typing calories auto-rebalances carbs/fat only when the trio is fully
   * populated AND the selection shares one diet type (mixed diets can't share
   * one rebalance). */
  function onCaloriesChange(value: string) {
    setCalories(value);
    const target = toInt(value) ?? 0;
    if (
      target > 0 &&
      seed.dietType != null &&
      classifyAbsoluteMacros(protein, carbs, fat) === "verbatim"
    ) {
      const m = calculateDailyMacros(target, toInt(protein) ?? 0, false, seed.dietType);
      setCarbs(String(m.carbsG));
      setFat(String(m.fatG));
    }
  }

  /** The reconcile line's one-tap fix: snap calories to the macro sum
   * (deliberately NOT through onCaloriesChange — the typed macros stay). */
  function setCaloriesToMacros() {
    setCalories(String(macroCals));
  }

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
      const payload: RangeEditPayload = { mode: "absolute", calories: cal! };
      if (macroState === "verbatim") {
        payload.proteinG = p!;
        payload.carbG = c!;
        payload.fatG = f!;
      } else if (macroState === "protein-only") {
        payload.proteinG = p!;
      }
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
    calories,
    protein,
    carbs,
    fat,
    onCaloriesChange,
    setProtein,
    setCarbs,
    setFat,
    seed,
    macroState,
    macroCals,
    diff,
    matched,
    p,
    c,
    f,
    cal,
    setCaloriesToMacros,
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
