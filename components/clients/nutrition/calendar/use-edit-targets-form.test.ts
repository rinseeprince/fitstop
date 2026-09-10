import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { NutritionEvent } from "@/types/check-in";
import { resolveSelectedEvents } from "@/utils/nutrition-range-edit-model";
import { gramsToSplit, splitToGrams, type MacroSplit } from "@/lib/nutrition/macro-balance";
import { useEditTargetsForm } from "./use-edit-targets-form";

function ev(date: string, overrides: Partial<NutritionEvent> = {}): NutritionEvent {
  return {
    id: date,
    clientId: "c1",
    nutritionPlanId: "np-1",
    date,
    dayOfWeek: "monday",
    baselineCalories: 2000,
    trainingBurnCalories: 0,
    proteinG: 150,
    carbG: 200,
    fatG: 60,
    dietType: "balanced",
    isTrainingDay: false,
    calorieSurplusPercentage: null,
    isModified: false,
    note: null,
    coachNote: null,
    status: "scheduled",
    ...overrides,
  };
}

function resolve(events: NutritionEvent[]) {
  return resolveSelectedEvents(
    events.map((e) => e.date),
    new Map(events.map((e) => [e.date, e])),
    true,
    false
  );
}

const SPLIT: MacroSplit = { carbs: 45, fat: 25, protein: 30 };

describe("useEditTargetsForm — Set targets is the balancer", () => {
  it("opens on the first selected day's calories and split", () => {
    const days = resolve([ev("2026-06-01"), ev("2026-06-02", { baselineCalories: 2200 })]);
    const { result } = renderHook(() => useEditTargetsForm(true, days));

    expect(result.current.balance).toEqual({
      calories: 2000,
      split: gramsToSplit({ proteinG: 150, carbG: 200, fatG: 60 }),
    });
    expect(result.current.seed.calorieRange).toEqual({ min: 2000, max: 2200 });
  });

  it("the absolute payload carries all four numbers — the target and the grams its split derives — for every selected day", () => {
    const days = resolve([ev("2026-06-01"), ev("2026-06-02"), ev("2026-06-03")]);
    const { result } = renderHook(() => useEditTargetsForm(true, days));

    act(() => result.current.setBalance({ calories: 2400, split: SPLIT }));

    expect(result.current.valid).toBe(true);
    // One payload for the whole selection: the hook that applies it sends it
    // with every resolved date, so the three days get the same four numbers.
    expect(result.current.buildPayload()).toEqual({
      mode: "absolute",
      calories: 2400,
      proteinG: 180,
      carbG: 269,
      fatG: 67,
    });
    expect(result.current.buildPayload()).toMatchObject(splitToGrams(2400, SPLIT));
  });

  it("no calorie target means no payload", () => {
    const days = resolve([ev("2026-06-01")]);
    const { result } = renderHook(() => useEditTargetsForm(true, days));

    act(() => result.current.setBalance({ calories: null, split: SPLIT }));

    expect(result.current.valid).toBe(false);
    expect(result.current.buildPayload()).toBeNull();
  });

  it("seeds once per open — a re-resolved selection mid-edit does not clobber the coach's numbers", () => {
    const first = resolve([ev("2026-06-01")]);
    const { result, rerender } = renderHook(
      ({ open, days }) => useEditTargetsForm(open, days),
      { initialProps: { open: true, days: first } }
    );
    act(() => result.current.setBalance({ calories: 2400, split: SPLIT }));

    // An SWR revalidation hands the sheet a new array of the same day.
    rerender({ open: true, days: resolve([ev("2026-06-01")]) });
    expect(result.current.balance).toEqual({ calories: 2400, split: SPLIT });

    // Closing and reopening seeds again.
    rerender({ open: false, days: first });
    rerender({ open: true, days: resolve([ev("2026-06-01", { baselineCalories: 1800 })]) });
    expect(result.current.balance.calories).toBe(1800);
  });
});

describe("useEditTargetsForm — the note (D-B), unchanged", () => {
  it("a single-day edit sends its note verbatim, an empty one included — it is authoritative", () => {
    const days = resolve([ev("2026-06-01", { isModified: true, note: "Deload" })]);
    const { result } = renderHook(() => useEditTargetsForm(true, days));

    expect(result.current.note).toBe("Deload");
    act(() => result.current.setNote(""));
    expect(result.current.buildPayload()).toMatchObject({ mode: "absolute", note: "" });
  });

  it("a multi-day edit sends a note only when one was typed", () => {
    const days = resolve([ev("2026-06-01"), ev("2026-06-02")]);
    const { result } = renderHook(() => useEditTargetsForm(true, days));

    expect(result.current.buildPayload()).not.toHaveProperty("note");
    act(() => result.current.setNote("Big week"));
    expect(result.current.buildPayload()).toMatchObject({ note: "Big week" });
  });
});
