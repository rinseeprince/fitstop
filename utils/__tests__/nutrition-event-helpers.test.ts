import { describe, it, expect } from "vitest";
import { mapNutritionEventToDisplayTarget } from "../nutrition-event-helpers";
import type { NutritionEvent } from "@/types/check-in";

function ev(overrides: Partial<NutritionEvent>): NutritionEvent {
  return {
    id: "ne-1",
    clientId: "c1",
    nutritionPlanId: "np-1",
    date: "2026-06-20",
    dayOfWeek: "saturday",
    baselineCalories: 2000,
    trainingBurnCalories: 0,
    proteinG: 150,
    carbG: 200,
    fatG: 67,
    dietType: "balanced",
    isTrainingDay: false,
    calorieSurplusPercentage: null,
    includeActivityBurn: true,
    surplusAsCarbs: false,
    isModified: false,
    note: null,
    status: "scheduled",
    coachNote: null,
    ...overrides,
  };
}

describe("mapNutritionEventToDisplayTarget", () => {
  it("shows a MODIFIED day's stored macros verbatim even with activity burn on", () => {
    // Coach manually set an unusual split (high carb / low fat) on a frozen day.
    const event = ev({
      isModified: true,
      baselineCalories: 2586,
      proteinG: 190,
      carbG: 250,
      fatG: 47,
      calorieSurplusPercentage: null,
    });

    const target = mapNutritionEventToDisplayTarget(event);

    expect(target.calories).toBe(2586);
    expect(target.proteinG).toBe(190);
    expect(target.carbsG).toBe(250); // NOT recalculated to the diet split
    expect(target.fatG).toBe(47);
  });

  it("shows stored macros verbatim on a non-modified day with NO surplus (burn on)", () => {
    // The reported bug: a flat custom plan (burn on, surplus 0) must NOT re-split.
    const event = ev({
      isModified: false,
      baselineCalories: 2502,
      proteinG: 200,
      carbG: 250,
      fatG: 78,
      calorieSurplusPercentage: null,
    });

    const target = mapNutritionEventToDisplayTarget(event);

    expect(target.calories).toBe(2502);
    expect(target.carbsG).toBe(250); // NOT re-derived to 213
    expect(target.fatG).toBe(78);
  });

  it("keep-split: preserves the stored carb:fat ratio on a training surplus", () => {
    const event = ev({
      isModified: false,
      isTrainingDay: true,
      baselineCalories: 2000,
      proteinG: 150,
      carbG: 100, // stored carb:fat = 400:450 cal
      fatG: 50,
      calorieSurplusPercentage: 10, // total = 2200
    });

    const target = mapNutritionEventToDisplayTarget(event); // the day's surplusAsCarbs is false

    // protein held; the +200 surplus splits by the stored 400:450 ratio
    expect(target.calories).toBe(2200);
    expect(target.proteinG).toBe(150);
    expect(target.carbsG).toBe(188);
    expect(target.fatG).toBe(94);
  });

  it("carbs-only: protein AND fat held, the whole surplus goes to carbs", () => {
    const event = ev({
      isModified: false,
      isTrainingDay: true,
      baselineCalories: 2000,
      proteinG: 150,
      carbG: 100,
      fatG: 50,
      calorieSurplusPercentage: 10, // total = 2200
      surplusAsCarbs: true,
    });

    const target = mapNutritionEventToDisplayTarget(event);

    expect(target.calories).toBe(2200);
    expect(target.proteinG).toBe(150); // held
    expect(target.fatG).toBe(50); // held
    // carbs absorb the rest: (2200 - 600 - 450) / 4 = 288
    expect(target.carbsG).toBe(288);
  });

  it("uses stored macros when activity burn is off (unchanged)", () => {
    const event = ev({
      baselineCalories: 2000,
      proteinG: 150,
      carbG: 200,
      fatG: 67,
      includeActivityBurn: false,
    });
    const target = mapNutritionEventToDisplayTarget(event);
    expect(target.calories).toBe(2000);
    expect(target.carbsG).toBe(200);
    expect(target.fatG).toBe(67);
  });
});

describe("mapNutritionEventToDisplayTarget — the day's own surplus settings (migration 196)", () => {
  const trainingDay = (overrides: Partial<NutritionEvent>) =>
    ev({
      isTrainingDay: true,
      baselineCalories: 2230,
      proteinG: 177,
      carbG: 226,
      fatG: 70,
      calorieSurplusPercentage: 12,
      ...overrides,
    });

  it("adds the session's surplus only when the day's own setting is on", () => {
    const on = mapNutritionEventToDisplayTarget(trainingDay({ includeActivityBurn: true }));
    const off = mapNutritionEventToDisplayTarget(trainingDay({ includeActivityBurn: false }));

    expect(on.calories).toBe(2498);
    expect(on.trainingSessionCalories).toBe(268);
    expect(off.calories).toBe(2230);
    expect(off.trainingSessionCalories).toBe(0);
    expect(off.carbsG).toBe(226);
    expect(off.fatG).toBe(70);
  });

  it("splits the surplus by the day's own surplusAsCarbs, not a shared switch", () => {
    const keepSplit = mapNutritionEventToDisplayTarget(trainingDay({ surplusAsCarbs: false }));
    const carbsOnly = mapNutritionEventToDisplayTarget(trainingDay({ surplusAsCarbs: true }));

    expect(carbsOnly.calories).toBe(keepSplit.calories);
    expect(carbsOnly.fatG).toBe(70);
    expect(keepSplit.fatG).toBeGreaterThan(70);
    expect(carbsOnly.carbsG).toBeGreaterThan(keepSplit.carbsG);
  });
});
