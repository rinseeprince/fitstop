import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getTrainingWeekStart,
  getTrainingWeekEnd,
  resolveCheckInWindow,
  getCheckInStatus,
  getDeviceTimeZone,
} from "@/lib/date-helpers";

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

describe("getCheckInStatus — activation-aware first-check-in gating", () => {
  it("brand-new, missed first check-in whose window post-dates activation -> overdue (loggable)", () => {
    // Wed 2024-01-17, check-in Monday -> periodEnd 2024-01-15; activated 2024-01-10 (before).
    expect(getCheckInStatus("monday", null, at("2024-01-17"), "2024-01-10").status).toBe("overdue");
  });

  it("brand-new whose window ended before activation -> not_due (pushed to next week)", () => {
    // periodEnd 2024-01-15 predates activation 2024-01-16 -> nothing to check in for.
    expect(getCheckInStatus("monday", null, at("2024-01-17"), "2024-01-16").status).toBe("not_due");
  });

  it("on the check-in day -> available", () => {
    expect(getCheckInStatus("monday", null, at("2024-01-15"), "2024-01-10").status).toBe("available");
  });

  it("established client missing a check-in stays overdue (unchanged)", () => {
    expect(getCheckInStatus("monday", "2024-01-08", at("2024-01-17"), "2023-01-01").status).toBe("overdue");
  });
});
