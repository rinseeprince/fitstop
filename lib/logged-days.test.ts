import { describe, it, expect } from "vitest";
import {
  LOGGED_DAY_SOURCES,
  CLIENT_MEASUREMENT_SOURCE,
  hasNutritionEntry,
  hasWellnessReading,
  isTrainingLogStatus,
  loggedDays,
  type LoggedDaySources,
} from "./logged-days";

const NONE: LoggedDaySources = {
  wellness: [],
  nutrition: [],
  habits: [],
  training: [],
  measurements: [],
};
const WEEK = { from: "2026-08-24", to: "2026-08-30" };

describe("loggedDays", () => {
  it("counts a day the client only trained", () => {
    expect(loggedDays({ ...NONE, training: ["2026-08-25"] }, WEEK)).toEqual(["2026-08-25"]);
  });

  it("counts a day the client only ticked a habit", () => {
    expect(loggedDays({ ...NONE, habits: ["2026-08-26"] }, WEEK)).toEqual(["2026-08-26"]);
  });

  it("counts a day the client only logged wellness", () => {
    expect(loggedDays({ ...NONE, wellness: ["2026-08-27"] }, WEEK)).toEqual(["2026-08-27"]);
  });

  it("counts a day the client only logged food", () => {
    expect(loggedDays({ ...NONE, nutrition: ["2026-08-28"] }, WEEK)).toEqual(["2026-08-28"]);
  });

  it("counts a day the client only logged a measurement", () => {
    expect(loggedDays({ ...NONE, measurements: ["2026-08-29"] }, WEEK)).toEqual(["2026-08-29"]);
  });

  it("leaves a day outside the range out, at either end", () => {
    const sources = { ...NONE, training: ["2026-08-23", "2026-08-31"], habits: ["2026-08-24"] };
    expect(loggedDays(sources, WEEK)).toEqual(["2026-08-24"]);
  });

  it("returns each day once, sorted, when several sources share it", () => {
    const sources: LoggedDaySources = {
      wellness: ["2026-08-30", "2026-08-25"],
      nutrition: ["2026-08-25"],
      habits: ["2026-08-30", "2026-08-25"],
      training: ["2026-08-27"],
      measurements: ["2026-08-27"],
    };
    expect(loggedDays(sources, WEEK)).toEqual(["2026-08-25", "2026-08-27", "2026-08-30"]);
  });

  it("returns nothing for a client with no log of any kind", () => {
    expect(loggedDays(NONE, WEEK)).toEqual([]);
  });

  it("takes exactly the five client sources — a coach entry or a check-in has no input", () => {
    // Owner decision D11: coach entries and check-in submissions do not count.
    // They cannot count, because there is no list to put them on.
    expect([...LOGGED_DAY_SOURCES]).toEqual([
      "wellness",
      "nutrition",
      "habits",
      "training",
      "measurements",
    ]);
    expect(CLIENT_MEASUREMENT_SOURCE).toBe("client_log");
  });
});

describe("the source predicates", () => {
  it("a workout log is a completed or partial event, never a scheduled, missed or skipped one", () => {
    expect(isTrainingLogStatus("completed")).toBe(true);
    expect(isTrainingLogStatus("partial")).toBe(true);
    expect(isTrainingLogStatus("scheduled")).toBe(false);
    expect(isTrainingLogStatus("missed")).toBe(false);
    expect(isTrainingLogStatus("skipped")).toBe(false);
  });

  it("a wellness row counts on any single reading and not on none", () => {
    expect(hasWellnessReading({ mood: 3 })).toBe(true);
    expect(hasWellnessReading({ energy: 6 })).toBe(true);
    expect(hasWellnessReading({ sleep: 7 })).toBe(true);
    expect(hasWellnessReading({ stress: 2 })).toBe(true);
    expect(hasWellnessReading({ soreness: 4 })).toBe(true);
    expect(hasWellnessReading({})).toBe(false);
    expect(
      hasWellnessReading({ mood: null, energy: null, sleep: null, stress: null, soreness: null })
    ).toBe(false);
  });

  it("a nutrition row counts on any single consumed value and not on none", () => {
    expect(hasNutritionEntry({ caloriesConsumed: 2100 })).toBe(true);
    expect(hasNutritionEntry({ proteinG: 150 })).toBe(true);
    expect(hasNutritionEntry({ carbsG: 210 })).toBe(true);
    expect(hasNutritionEntry({ fatG: 70 })).toBe(true);
    expect(hasNutritionEntry({})).toBe(false);
    expect(
      hasNutritionEntry({ caloriesConsumed: null, proteinG: null, carbsG: null, fatG: null })
    ).toBe(false);
  });
});
