import { describe, it, expect } from "vitest";
import { getTodayDateStringInTimezone, safeTimeZone } from "@/lib/date-helpers";
import { canEditDay } from "@/lib/daily-log-permissions";

describe("safeTimeZone", () => {
  it("returns valid IANA zones unchanged", () => {
    expect(safeTimeZone("America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(safeTimeZone("UTC")).toBe("UTC");
    expect(safeTimeZone("Asia/Tokyo")).toBe("Asia/Tokyo");
  });

  it("falls back to UTC for invalid/empty zones", () => {
    expect(safeTimeZone("Mars/Olympus")).toBe("UTC");
    expect(safeTimeZone("")).toBe("UTC");
    expect(safeTimeZone(null)).toBe("UTC");
    expect(safeTimeZone(undefined)).toBe("UTC");
  });
});

describe("getTodayDateStringInTimezone", () => {
  it("resolves the client-local day across the midnight boundary", () => {
    // 2026-05-21T05:30:00Z is still 2026-05-20 (22:30 PDT) in Los Angeles.
    const instant = new Date("2026-05-21T05:30:00Z");
    expect(getTodayDateStringInTimezone("UTC", instant)).toBe("2026-05-21");
    expect(getTodayDateStringInTimezone("America/Los_Angeles", instant)).toBe("2026-05-20");
  });

  it("handles DST spring-forward (America/Los_Angeles, 2026-03-08)", () => {
    // Clocks jump PST→PDT at 02:00 local. 07:30Z = 23:30 PST on 03-07; 09:30Z = 01:30 PST on 03-08.
    expect(
      getTodayDateStringInTimezone("America/Los_Angeles", new Date("2026-03-08T07:30:00Z"))
    ).toBe("2026-03-07");
    expect(
      getTodayDateStringInTimezone("America/Los_Angeles", new Date("2026-03-08T09:30:00Z"))
    ).toBe("2026-03-08");
  });

  it("handles DST fall-back (America/Los_Angeles, 2026-11-01)", () => {
    // Clocks fall PDT→PST at 02:00 local. 06:30Z = 23:30 PDT on 10-31; 08:30Z = 01:30 PDT on 11-01.
    expect(
      getTodayDateStringInTimezone("America/Los_Angeles", new Date("2026-11-01T06:30:00Z"))
    ).toBe("2026-10-31");
    expect(
      getTodayDateStringInTimezone("America/Los_Angeles", new Date("2026-11-01T08:30:00Z"))
    ).toBe("2026-11-01");
  });

  it("changing timezone changes the resolved day for the same instant", () => {
    const instant = new Date("2026-05-21T05:30:00Z");
    expect(getTodayDateStringInTimezone("America/New_York", instant)).toBe("2026-05-21");
    expect(getTodayDateStringInTimezone("Asia/Tokyo", instant)).toBe("2026-05-21"); // 14:30 JST
    // The helper reads the zone fresh each call — no cached value.
    expect(getTodayDateStringInTimezone("Pacific/Honolulu", instant)).toBe("2026-05-20"); // 19:30 HST
  });

  it("falls back to UTC for an invalid zone (no throw)", () => {
    const instant = new Date("2026-05-21T05:30:00Z");
    expect(getTodayDateStringInTimezone("Mars/Olympus", instant)).toBe(
      getTodayDateStringInTimezone("UTC", instant)
    );
  });
});

describe("canEditDay", () => {
  const tz = "UTC";
  const today = getTodayDateStringInTimezone(tz);
  const shift = (days: number): string => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const yesterday = shift(-1);
  const tomorrow = shift(1);

  it("today is always editable (logged or not)", () => {
    expect(canEditDay(today, "never-logged", tz)).toBe(true);
    expect(canEditDay(today, "logged", tz)).toBe(true);
  });

  it("past day is editable only when never logged", () => {
    expect(canEditDay(yesterday, "never-logged", tz)).toBe(true);
    expect(canEditDay(yesterday, "logged", tz)).toBe(false);
  });

  it("future day is never editable", () => {
    expect(canEditDay(tomorrow, "never-logged", tz)).toBe(false);
    expect(canEditDay(tomorrow, "logged", tz)).toBe(false);
  });

  it("treats an invalid timezone as UTC", () => {
    // today (UTC) is still editable when the zone is bogus (falls back to UTC).
    expect(canEditDay(today, "logged", "Mars/Olympus")).toBe(true);
  });
});
