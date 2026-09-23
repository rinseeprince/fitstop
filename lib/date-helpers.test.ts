import { describe, it, expect } from "vitest";
import { getTodayDateString, isCalendarDay, parseDateParamOrToday } from "./date-helpers";

describe("isCalendarDay", () => {
  it("accepts a real day", () => {
    expect(isCalendarDay("2026-10-19")).toBe(true);
    expect(isCalendarDay("2028-02-29")).toBe(true);
  });

  it("refuses what only looks like a date, or not even that", () => {
    expect(isCalendarDay("2026-02-30")).toBe(false);
    expect(isCalendarDay("2026-13-45")).toBe(false);
    expect(isCalendarDay("2027-02-29")).toBe(false);
    expect(isCalendarDay("2026-9-1")).toBe(false);
    expect(isCalendarDay("")).toBe(false);
  });
});

describe("parseDateParamOrToday", () => {
  it("keeps a real day and falls back to today for anything else", () => {
    expect(parseDateParamOrToday("2026-11-04")).toBe("2026-11-04");
    expect(parseDateParamOrToday("2026-04-31")).toBe(getTodayDateString());
    expect(parseDateParamOrToday(null)).toBe(getTodayDateString());
  });
});
