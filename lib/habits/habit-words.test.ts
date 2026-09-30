import { describe, it, expect } from "vitest";
import { habitNumber, habitWords, scheduleWords, targetWords, weekFigurePercent, weekFigureWords } from "./habit-words";

describe("scheduleWords", () => {
  it("says every day for all seven, and the chosen days Monday first otherwise", () => {
    expect(
      scheduleWords({
        timesPerWeek: null,
        weekdays: ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"],
      })
    ).toBe("Every day");
    expect(scheduleWords({ timesPerWeek: null, weekdays: ["friday", "monday", "wednesday"] })).toBe("Mon, Wed, Fri");
    expect(scheduleWords({ timesPerWeek: null, weekdays: ["sunday"] })).toBe("Sun");
  });

  it("says how many times a week for a weekly habit", () => {
    expect(scheduleWords({ timesPerWeek: 1, weekdays: [] })).toBe("Once a week");
    expect(scheduleWords({ timesPerWeek: 2, weekdays: [] })).toBe("Twice a week");
    expect(scheduleWords({ timesPerWeek: 3, weekdays: [] })).toBe("3 times a week");
  });
});

describe("targetWords", () => {
  const water = { measure: "number" as const, unit: "L", direction: "at_least" as const };
  const drinks = { measure: "number" as const, unit: "drinks", direction: "at_most" as const };

  it("says the target in its direction and the coach's unit, as typed", () => {
    expect(targetWords(water, 3)).toBe("at least 3 L");
    expect(targetWords(drinks, 2)).toBe("at most 2 drinks");
    expect(targetWords({ ...water, unit: "steps" }, 6000)).toBe("at least 6,000 steps");
    expect(targetWords({ ...water, unit: null }, 2.5)).toBe("at least 2.5");
  });

  it("has nothing to say for a tick habit", () => {
    expect(targetWords({ measure: "tick", unit: null, direction: null }, null)).toBeNull();
  });
});

describe("habitNumber and weekFigureWords", () => {
  it("reads a number to two decimals at most, grouped by thousands", () => {
    expect([3, 2.5, 0.25, 6000, 12345.67].map(habitNumber)).toEqual(["3", "2.5", "0.25", "6,000", "12,345.67"]);
  });

  it("reads a week as met of planned, or as nothing planned", () => {
    expect(weekFigureWords({ planned: 3, done: 4, met: 3 })).toBe("3 of 3");
    expect(weekFigureWords({ planned: 7, done: 4, met: 4 })).toBe("4 of 7");
    expect(weekFigureWords({ planned: 0, done: 1, met: 0 })).toBe("Nothing planned");
  });

  it("reads a week as a whole percentage of met over planned, and none with nothing planned", () => {
    expect(weekFigurePercent({ planned: 13, done: 8, met: 8 })).toBe(62);
    expect(weekFigurePercent({ planned: 3, done: 7, met: 3 })).toBe(100);
    expect(weekFigurePercent({ planned: 3, done: 0, met: 0 })).toBe(0);
    expect(weekFigurePercent({ planned: 0, done: 2, met: 0 })).toBeNull();
  });
});

describe("habitWords", () => {
  const water = { measure: "number" as const, unit: "L", direction: "at_least" as const };

  it("reads the version's schedule and its target, or the day's target when given", () => {
    const version = { timesPerWeek: null, weekdays: ["monday" as const, "thursday" as const], target: 3 };
    expect(habitWords(water, version)).toEqual({ schedule: "Mon, Thu", target: "at least 3 L" });
    expect(habitWords(water, version, 2)).toEqual({ schedule: "Mon, Thu", target: "at least 2 L" });
    expect(habitWords(water, null)).toEqual({ schedule: null, target: null });
  });
});
