import { describe, it, expect } from "vitest";
import { formatHistoryDate, getTodayDateString, isCalendarDay, parseDateParamOrToday, weekdayOf } from "./date-helpers";

describe("weekdayOf", () => {
  it("names a calendar date's own weekday in the product's spelling", () => {
    expect(weekdayOf("2026-09-28")).toBe("monday");
    expect(weekdayOf("2026-09-30")).toBe("wednesday");
    expect(weekdayOf("2026-10-04")).toBe("sunday");
    expect(weekdayOf("2028-02-29")).toBe("tuesday");
  });

  it("reads the date's own weekday on a host west or east of UTC, not a neighbour's", () => {
    // The suite pins TZ=UTC, where a UTC and a local parse agree; Node applies a
    // TZ changed at runtime, so the two sides of the date line are tried here.
    const pinned = process.env.TZ;
    try {
      for (const zone of ["America/Los_Angeles", "Pacific/Auckland"]) {
        process.env.TZ = zone;
        expect(weekdayOf("2026-09-28")).toBe("monday");
      }
    } finally {
      process.env.TZ = pinned;
    }
  });
});

describe("formatHistoryDate", () => {
  const now = new Date("2026-09-23T12:00:00");

  it("is the short date in this year, and names any other year", () => {
    expect(formatHistoryDate("2026-03-02", now)).toBe("2 Mar");
    expect(formatHistoryDate("2025-12-29", now)).toBe("29 Dec 2025");
    expect(formatHistoryDate("2027-01-04", now)).toBe("4 Jan 2027");
  });
});

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
