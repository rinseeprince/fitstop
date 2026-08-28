import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getTrainingWeekStart,
  getTrainingWeekEnd,
  resolveCheckInWindow,
  getDeviceTimeZone,
  getTodayInTimezone,
  formatDateISO,
} from "@/lib/date-helpers";

describe("getTodayInTimezone", () => {
  it("returns a local-midnight Date for the zone's today (east of UTC)", () => {
    // 23:30 UTC June 9 is already 00:30 BST June 10 in London.
    const d = getTodayInTimezone("Europe/London", new Date("2026-06-09T23:30:00Z"));
    expect(formatDateISO(d)).toBe("2026-06-10");
    // 2026-06-10 is a Wednesday — .getDay() must agree with the date above
    // (the UTC-midnight pitfall this helper exists to avoid).
    expect(d.getDay()).toBe(3);
  });

  it("returns the previous day west of UTC", () => {
    // 00:30 UTC June 10 is still 17:30 June 9 in Los Angeles.
    const d = getTodayInTimezone("America/Los_Angeles", new Date("2026-06-10T00:30:00Z"));
    expect(formatDateISO(d)).toBe("2026-06-09");
  });

  it("falls back to UTC for an invalid zone", () => {
    const d = getTodayInTimezone("Mars/Olympus", new Date("2026-06-09T23:30:00Z"));
    expect(formatDateISO(d)).toBe("2026-06-09");
  });
});

describe("getDeviceTimeZone", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the device's Intl time zone", () => {
    const expected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(getDeviceTimeZone()).toBe(expected);
  });

  it("returns undefined when Intl.DateTimeFormat throws", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
      throw new RangeError("unavailable");
    });
    expect(getDeviceTimeZone()).toBeUndefined();
  });

  it("returns undefined when the resolved zone is empty", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(
      () =>
        ({
          resolvedOptions: () => ({ timeZone: "" }),
        }) as unknown as Intl.DateTimeFormat,
    );
    expect(getDeviceTimeZone()).toBeUndefined();
  });
});

// Local noon keeps getDay()/getDateString stable regardless of the runner's TZ.
const at = (d: string) => new Date(d + "T12:00:00");

describe("getTrainingWeekStart", () => {
  it("defaults to Monday when checkInDay is null", () => {
    // 2026-03-30 is a Monday
    expect(getTrainingWeekStart("2026-03-30", null)).toBe("2026-03-30");
    // 2026-03-31 is a Tuesday
    expect(getTrainingWeekStart("2026-03-31", null)).toBe("2026-03-30");
    // 2026-04-05 is a Sunday
    expect(getTrainingWeekStart("2026-04-05", null)).toBe("2026-03-30");
  });

  it("defaults to Monday when checkInDay is undefined", () => {
    expect(getTrainingWeekStart("2026-03-31")).toBe("2026-03-30");
  });

  it("uses day after check-in day as week start for Sunday check-in", () => {
    // Check-in on Sunday -> week starts Monday (same as default)
    // 2026-03-30 is Monday, should be start of its own week
    expect(getTrainingWeekStart("2026-03-30", "sunday")).toBe("2026-03-30");
    // 2026-04-05 is Sunday (check-in day), last day of the week
    expect(getTrainingWeekStart("2026-04-05", "sunday")).toBe("2026-03-30");
  });

  it("uses day after check-in day for Wednesday check-in", () => {
    // Check-in on Wednesday -> week starts Thursday
    // 2026-04-02 is Thursday -> start of its own week
    expect(getTrainingWeekStart("2026-04-02", "wednesday")).toBe("2026-04-02");
    // 2026-04-01 is Wednesday (check-in day) -> last day of previous week
    expect(getTrainingWeekStart("2026-04-01", "wednesday")).toBe("2026-03-26");
    // 2026-03-30 is Monday -> still in the Thu Mar 26 week
    expect(getTrainingWeekStart("2026-03-30", "wednesday")).toBe("2026-03-26");
    // 2026-04-05 is Sunday -> in the Thu Apr 2 week
    expect(getTrainingWeekStart("2026-04-05", "wednesday")).toBe("2026-04-02");
  });

  it("uses day after check-in day for Saturday check-in", () => {
    // Check-in on Saturday -> week starts Sunday
    // 2026-03-29 is Sunday -> start of its own week
    expect(getTrainingWeekStart("2026-03-29", "saturday")).toBe("2026-03-29");
    // 2026-03-28 is Saturday (check-in day) -> last day of previous week
    expect(getTrainingWeekStart("2026-03-28", "saturday")).toBe("2026-03-22");
    // 2026-04-04 is Saturday -> last day of current week
    expect(getTrainingWeekStart("2026-04-04", "saturday")).toBe("2026-03-29");
  });

  it("handles date on the week start day itself", () => {
    // Wednesday check-in -> week starts Thursday
    // 2026-04-02 is Thursday -> should be start of current week, not previous
    expect(getTrainingWeekStart("2026-04-02", "wednesday")).toBe("2026-04-02");
  });

  it("handles date on the check-in day (last day of week)", () => {
    // Wednesday check-in -> week starts Thursday, ends Wednesday
    // 2026-04-08 is Wednesday -> last day of the Apr 2 week
    expect(getTrainingWeekStart("2026-04-08", "wednesday")).toBe("2026-04-02");
  });
});

describe("getTrainingWeekEnd", () => {
  it("returns 6 days after week start", () => {
    // Monday start -> Sunday end
    expect(getTrainingWeekEnd("2026-03-30", null)).toBe("2026-04-05");
    // Thursday start (Wednesday check-in) -> Wednesday end
    expect(getTrainingWeekEnd("2026-04-02", "wednesday")).toBe("2026-04-08");
  });
});

describe("resolveCheckInWindow", () => {
  it("established client -> full 7-day window ending on the check-in day", () => {
    // 2024-01-15 is a Monday.
    expect(resolveCheckInWindow(at("2024-01-15"), "monday", "2023-01-01")).toEqual({
      periodStart: "2024-01-09",
      periodEnd: "2024-01-15",
    });
  });

  it("mid-week activation -> start clamped to the activation date (partial week)", () => {
    expect(resolveCheckInWindow(at("2024-01-15"), "monday", "2024-01-12")).toEqual({
      periodStart: "2024-01-12",
      periodEnd: "2024-01-15",
    });
  });

  it("logging late keeps the window anchored to the most recent check-in day", () => {
    // Wednesday 2024-01-17, check-in day Monday -> window still ends 2024-01-15.
    expect(resolveCheckInWindow(at("2024-01-17"), "monday", "2023-01-01")).toEqual({
      periodStart: "2024-01-09",
      periodEnd: "2024-01-15",
    });
  });

  it("no check-in day -> trailing 7 days ending today", () => {
    expect(resolveCheckInWindow(at("2024-01-15"), null, "2023-01-01")).toEqual({
      periodStart: "2024-01-09",
      periodEnd: "2024-01-15",
    });
  });
});

