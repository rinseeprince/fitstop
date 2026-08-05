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
    isModified: false,
    note: null,
    status: "scheduled",
    createdAt: "",
    updatedAt: "",
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

    const target = mapNutritionEventToDisplayTarget(event, true);

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

    const target = mapNutritionEventToDisplayTarget(event, true);

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

    const target = mapNutritionEventToDisplayTarget(event, true); // surplusAsCarbs default false

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
    });

    const target = mapNutritionEventToDisplayTarget(event, true, true);

    expect(target.calories).toBe(2200);
    expect(target.proteinG).toBe(150); // held
    expect(target.fatG).toBe(50); // held
    // carbs absorb the rest: (2200 - 600 - 450) / 4 = 288
    expect(target.carbsG).toBe(288);
  });

  it("uses stored macros when activity burn is off (unchanged)", () => {
    const event = ev({ baselineCalories: 2000, proteinG: 150, carbG: 200, fatG: 67 });
    const target = mapNutritionEventToDisplayTarget(event, false);
    expect(target.calories).toBe(2000);
    expect(target.carbsG).toBe(200);
    expect(target.fatG).toBe(67);
  });
});
