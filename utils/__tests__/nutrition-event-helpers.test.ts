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
    status: "scheduled",
    createdAt: "",
    updatedAt: "",
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

  it("still recalculates the split for an UNMODIFIED training day with surplus", () => {
    const event = ev({
      isModified: false,
      isTrainingDay: true,
      baselineCalories: 2000,
      proteinG: 150,
      carbG: 100, // stored rest-day macros
      fatG: 50,
      calorieSurplusPercentage: 10, // total = 2200
    });

    const target = mapNutritionEventToDisplayTarget(event, true);

    // balanced: protein held (150), remaining 1600 split 50/50 -> 200c / 89f
    expect(target.calories).toBe(2200);
    expect(target.proteinG).toBe(150);
    expect(target.carbsG).toBe(200); // recalculated, not the stored 100
    expect(target.fatG).toBe(89);
  });

  it("uses stored macros when activity burn is off (unchanged)", () => {
    const event = ev({ baselineCalories: 2000, proteinG: 150, carbG: 200, fatG: 67 });
    const target = mapNutritionEventToDisplayTarget(event, false);
    expect(target.calories).toBe(2000);
    expect(target.carbsG).toBe(200);
    expect(target.fatG).toBe(67);
  });
});
