import { describe, it, expect } from "vitest";
import { nutritionDayOfWeek, resolveNutritionDay } from "./nutrition-day-resolver";

// The one function every reader computes a day from. Pure, so these are the
// numbers themselves — no mocks, no database. Every fixture number is distinct
// so a swapped field cannot pass.

const VERSION = {
  id: "v-2810",
  baselineCalories: 2100,
  proteinTargetG: 160,
  dietType: "balanced",
  includeActivityBurn: true,
  surplusAsCarbs: false,
};
const GRID_ROW = { calories: 1950, proteinG: 155, carbG: 210, fatG: 65 };

const base = {
  clientId: "client-31",
  date: "2026-09-14", // a Monday
  version: VERSION,
  gridRow: GRID_ROW,
  trainingEvents: [] as { calorieSurplusPercentage: number | null; estimatedCalories: number | null }[],
  edit: null,
  coachNote: null,
};

describe("resolveNutritionDay", () => {
  it("a rest day takes the grid row verbatim: no surplus, no burn, the version's identity", () => {
    const day = resolveNutritionDay(base);

    expect(day).toEqual({
      id: "2026-09-14",
      clientId: "client-31",
      nutritionPlanId: "v-2810",
      date: "2026-09-14",
      dayOfWeek: "monday",
      baselineCalories: 1950,
      trainingBurnCalories: 0,
      proteinG: 155,
      carbG: 210,
      fatG: 65,
      dietType: "balanced",
      isTrainingDay: false,
      calorieSurplusPercentage: null,
      includeActivityBurn: true,
      surplusAsCarbs: false,
      isModified: false,
      note: null,
      coachNote: null,
      status: "scheduled",
    });
  });

  it("no grid row: the version's baseline, split by diet type with protein held at the target", () => {
    const day = resolveNutritionDay({ ...base, gridRow: null });

    // 2100 − 160×4 = 1460 kcal left; balanced halves it: 730/4 → 183 g carbs
    // (182.5 rounds up), 730/9 → 81 g fat.
    expect(day.baselineCalories).toBe(2100);
    expect(day.proteinG).toBe(160);
    expect(day.carbG).toBe(183);
    expect(day.fatG).toBe(81);
  });

  it("a session's surplus: the burn is that share of the baseline, and the day is a training day", () => {
    const day = resolveNutritionDay({
      ...base,
      trainingEvents: [{ calorieSurplusPercentage: 12, estimatedCalories: 400 }],
    });

    expect(day.isTrainingDay).toBe(true);
    expect(day.calorieSurplusPercentage).toBe(12);
    expect(day.trainingBurnCalories).toBe(234); // round(1950 × 12 / 100)
    // The estimate is the legacy path and plays no part once a surplus exists.
    expect(day.trainingBurnCalories).not.toBe(400);
    // The macros stay the grid's: the surplus split is the display layer's.
    expect([day.proteinG, day.carbG, day.fatG]).toEqual([155, 210, 65]);
  });

  it("legacy: with no surplus the burn is the flat sum of the sessions' estimated calories", () => {
    const day = resolveNutritionDay({
      ...base,
      trainingEvents: [
        { calorieSurplusPercentage: null, estimatedCalories: 350 },
        { calorieSurplusPercentage: null, estimatedCalories: 150 },
      ],
    });

    expect(day.calorieSurplusPercentage).toBeNull();
    expect(day.trainingBurnCalories).toBe(500);
    expect(day.isTrainingDay).toBe(true);
  });

  it("a day holding several sessions adds every session's surplus", () => {
    const day = resolveNutritionDay({
      ...base,
      trainingEvents: [
        { calorieSurplusPercentage: 10, estimatedCalories: null },
        { calorieSurplusPercentage: 15, estimatedCalories: null },
      ],
    });

    expect(day.calorieSurplusPercentage).toBe(25);
    expect(day.trainingBurnCalories).toBe(488); // round(1950 × 25 / 100)
    // The order on the day changes nothing.
    const reversed = resolveNutritionDay({
      ...base,
      trainingEvents: [
        { calorieSurplusPercentage: 15, estimatedCalories: null },
        { calorieSurplusPercentage: 10, estimatedCalories: null },
      ],
    });
    expect(reversed.calorieSurplusPercentage).toBe(25);
  });

  it("a session carrying no surplus adds nothing once another on the day carries one", () => {
    const day = resolveNutritionDay({
      ...base,
      trainingEvents: [
        { calorieSurplusPercentage: null, estimatedCalories: 300 },
        { calorieSurplusPercentage: 15, estimatedCalories: 0 },
      ],
    });

    // The estimate is the legacy path, read only when no session carries a surplus.
    expect(day.calorieSurplusPercentage).toBe(15);
    expect(day.trainingBurnCalories).toBe(293); // round(1950 × 15 / 100)
  });

  it("an edited day takes the edit verbatim, carries its note, and takes no surplus — even on a training day", () => {
    const day = resolveNutritionDay({
      ...base,
      trainingEvents: [{ calorieSurplusPercentage: 12, estimatedCalories: 400 }],
      edit: { calories: 1700, proteinG: 140, carbG: 180, fatG: 60, note: "Deload — knee flare-up" },
    });

    expect(day.isModified).toBe(true);
    expect(day.baselineCalories).toBe(1700);
    expect([day.proteinG, day.carbG, day.fatG]).toEqual([140, 180, 60]);
    expect(day.note).toBe("Deload — knee flare-up");
    expect(day.calorieSurplusPercentage).toBeNull();
    expect(day.trainingBurnCalories).toBe(0);
    // Live, not frozen: the badge follows the calendar.
    expect(day.isTrainingDay).toBe(true);
    expect(day.nutritionPlanId).toBe("v-2810");
    expect(day.dietType).toBe("balanced");
  });

  it("an edit without a note leaves the note null; an unedited day is never modified", () => {
    const edited = resolveNutritionDay({
      ...base,
      edit: { calories: 1700, proteinG: 140, carbG: 180, fatG: 60, note: null },
    });
    expect(edited.note).toBeNull();
    expect(edited.isModified).toBe(true);

    const plain = resolveNutritionDay(base);
    expect(plain.isModified).toBe(false);
    expect(plain.note).toBeNull();
  });

  it("the coach note rides through on any day", () => {
    expect(resolveNutritionDay({ ...base, coachNote: "Cut starts here" }).coachNote).toBe("Cut starts here");
    expect(
      resolveNutritionDay({
        ...base,
        coachNote: "Cut starts here",
        edit: { calories: 1700, proteinG: 140, carbG: 180, fatG: 60, note: null },
      }).coachNote
    ).toBe("Cut starts here");
  });

  it("a day carries its own version's two surplus settings, on a computed day and an edited one", () => {
    const version = { ...VERSION, includeActivityBurn: false, surplusAsCarbs: true };
    const computed = resolveNutritionDay({
      ...base,
      version,
      trainingEvents: [{ calorieSurplusPercentage: 9, estimatedCalories: 310 }],
    });
    const edited = resolveNutritionDay({
      ...base,
      version,
      edit: { calories: 1640, proteinG: 132, carbG: 171, fatG: 57, note: null },
    });

    expect([computed.includeActivityBurn, computed.surplusAsCarbs]).toEqual([false, true]);
    expect([edited.includeActivityBurn, edited.surplusAsCarbs]).toEqual([false, true]);
  });

  it("the id is the date and the status is always scheduled", () => {
    const day = resolveNutritionDay({ ...base, date: "2026-09-20" });
    expect(day.id).toBe("2026-09-20");
    expect(day.status).toBe("scheduled");
  });
});

describe("nutritionDayOfWeek", () => {
  it("spells the weekday the grid keys on, from a local-midnight parse", () => {
    expect(nutritionDayOfWeek("2026-09-14")).toBe("monday");
    expect(nutritionDayOfWeek("2026-09-17")).toBe("thursday");
    expect(nutritionDayOfWeek("2026-09-20")).toBe("sunday");
    expect(nutritionDayOfWeek("2026-09-21")).toBe("monday");
  });

  it("is the weekday the resolved day reports", () => {
    expect(resolveNutritionDay({ ...base, date: "2026-09-19" }).dayOfWeek).toBe("saturday");
  });
});
