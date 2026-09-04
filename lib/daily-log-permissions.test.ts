import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getTodayDateStringInTimezone, safeTimeZone } from "@/lib/date-helpers";
import { canEditDay, resolveLogsOpenFrom } from "@/lib/daily-log-permissions";

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

  it("today is editable", () => {
    expect(canEditDay(today, shift(-6), tz)).toBe(true);
  });

  it("the boundary day itself is editable — it is the first open day, not the last closed one", () => {
    // Mutation guard: flipping the comparison to `date > logsOpenFrom` locks the
    // first day of the client's own open week.
    expect(canEditDay(shift(-6), shift(-6), tz)).toBe(true);
    expect(canEditDay(shift(-7), shift(-6), tz)).toBe(false);
  });

  it("every day between the boundary and today is open, logged or not", () => {
    // Mutation guard: the rule takes no log state at all. There is no argument
    // for it to read, and adding one back would have to change the signature.
    for (let d = -6; d <= 0; d += 1) {
      expect(canEditDay(shift(d), shift(-6), tz)).toBe(true);
    }
  });

  it("a day before the boundary is locked however recent", () => {
    expect(canEditDay(shift(-7), shift(-6), tz)).toBe(false);
    expect(canEditDay(shift(-90), shift(-6), tz)).toBe(false);
  });

  it("the future is locked whatever the boundary says", () => {
    expect(canEditDay(shift(1), shift(-6), tz)).toBe(false);
    expect(canEditDay(shift(1), null, tz)).toBe(false);
  });

  it("a null boundary opens every past day up to today", () => {
    expect(canEditDay(shift(-365), null, tz)).toBe(true);
    expect(canEditDay(today, null, tz)).toBe(true);
  });

  it("treats an invalid timezone as UTC", () => {
    expect(canEditDay(today, null, "Mars/Olympus")).toBe(true);
  });

  it("judges the future against the CLIENT's calendar, not the server's", () => {
    // 2026-05-21T05:30Z is still 2026-05-20 in Los Angeles, so the 21st is that
    // client's tomorrow and locked, while it is a UTC client's today and open.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-05-21T05:30:00Z"));
      expect(canEditDay("2026-05-21", null, "UTC")).toBe(true);
      expect(canEditDay("2026-05-21", null, "America/Los_Angeles")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("resolveLogsOpenFrom", () => {
  // Sundays. The week a check-in reports on is Mon-Sun, ending on the due
  // weekday, so "today" inside that week resolves to that week's Monday.
  const SUNDAY_DUE = "2026-09-06";
  const at = (instant: string) => {
    vi.setSystemTime(new Date(instant));
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("with no check-in ever sent, opens at the start of the week the current check-in covers", () => {
    at("2026-09-03T12:00:00Z"); // Thursday
    // The outstanding check-in is the one for the week that ENDED last Sunday
    // (30 Aug), which is what the form would submit today — so its Monday is the
    // first open day, and the days since it are open too. That is the "about two
    // weeks" the rule describes: Mon 24 Aug through today.
    expect(
      resolveLogsOpenFrom(
        { timezone: "UTC", nextCheckInDue: SUNDAY_DUE, startDate: "2026-01-01" },
        null
      )
    ).toBe("2026-08-24");
  });

  it("rolls on the check-in weekday itself, locking the week just reported on", () => {
    // Saturday: the window in play still ends on the PREVIOUS Sunday.
    at("2026-09-05T12:00:00Z");
    const saturday = resolveLogsOpenFrom(
      { timezone: "UTC", nextCheckInDue: SUNDAY_DUE, startDate: "2026-01-01" },
      null
    );
    // Sunday: the window in play flips to the new week, so the old one locks.
    at("2026-09-06T12:00:00Z");
    const sunday = resolveLogsOpenFrom(
      { timezone: "UTC", nextCheckInDue: SUNDAY_DUE, startDate: "2026-01-01" },
      null
    );
    expect(sunday! > saturday!).toBe(true);
    expect(sunday).toBe("2026-08-31");
  });

  it("a submitted check-in closes its week and everything before it", () => {
    at("2026-09-03T12:00:00Z"); // Thursday, mid-week
    const openWeek = resolveLogsOpenFrom(
      { timezone: "UTC", nextCheckInDue: SUNDAY_DUE, startDate: "2026-01-01" },
      null
    );
    const afterSubmit = resolveLogsOpenFrom(
      { timezone: "UTC", nextCheckInDue: SUNDAY_DUE, startDate: "2026-01-01" },
      "2026-08-30" // they sent the check-in covering the week to Sun 30 Aug
    );
    // Mutation guard: taking the earlier of the two, or ignoring the submitted
    // period, would leave the reported week open after it was reported on.
    expect(afterSubmit).toBe("2026-08-31");
    expect(afterSubmit! >= openWeek!).toBe(true);
  });

  it("takes the LATER of the two closes when a submission is newer than the window start", () => {
    at("2026-09-03T12:00:00Z");
    // A submission covering days inside the current window (a client who checked
    // in early, or a coach who moved the due date) closes past its start.
    expect(
      resolveLogsOpenFrom(
        { timezone: "UTC", nextCheckInDue: SUNDAY_DUE, startDate: "2026-01-01" },
        "2026-09-02"
      )
    ).toBe("2026-09-03");
  });

  it("clamps to the client's start date for a partial first week", () => {
    at("2026-09-03T12:00:00Z");
    expect(
      resolveLogsOpenFrom(
        { timezone: "UTC", nextCheckInDue: SUNDAY_DUE, startDate: "2026-09-02" },
        null
      )
    ).toBe("2026-09-02");
  });

  it("a client with no schedule has no lower bound — nothing ever closes a week for them", () => {
    at("2026-09-03T12:00:00Z");
    expect(
      resolveLogsOpenFrom({ timezone: "UTC", nextCheckInDue: null, startDate: "2026-01-01" }, null)
    ).toBeNull();
  });

  it("...but a check-in they sent before losing the schedule still closes its own period", () => {
    at("2026-09-03T12:00:00Z");
    expect(
      resolveLogsOpenFrom(
        { timezone: "UTC", nextCheckInDue: null, startDate: "2026-01-01" },
        "2026-08-30"
      )
    ).toBe("2026-08-31");
  });

  it("resolves the window on the CLIENT's calendar", () => {
    // 2026-09-06T04:00Z is Sunday in UTC but still Saturday in Los Angeles, so
    // the two clients are looking at different weeks at the same instant.
    at("2026-09-06T04:00:00Z");
    const utc = resolveLogsOpenFrom(
      { timezone: "UTC", nextCheckInDue: SUNDAY_DUE, startDate: "2026-01-01" },
      null
    );
    const la = resolveLogsOpenFrom(
      { timezone: "America/Los_Angeles", nextCheckInDue: SUNDAY_DUE, startDate: "2026-01-01" },
      null
    );
    expect(utc! > la!).toBe(true);
  });
});
