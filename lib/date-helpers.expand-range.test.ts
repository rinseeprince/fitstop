import { describe, it, expect, afterEach } from "vitest";
import { expandDateRange } from "./date-helpers";

describe("expandDateRange", () => {
  it("includes both endpoints", () => {
    expect(expandDateRange("2026-04-10", "2026-04-12")).toEqual([
      "2026-04-10",
      "2026-04-11",
      "2026-04-12",
    ]);
  });

  it("returns the single date when start === end", () => {
    expect(expandDateRange("2026-04-10", "2026-04-10")).toEqual(["2026-04-10"]);
  });

  it("returns [] for an inverted range rather than falling back to a full window", () => {
    expect(expandDateRange("2026-04-12", "2026-04-10")).toEqual([]);
  });

  it("crosses a month boundary", () => {
    expect(expandDateRange("2026-01-30", "2026-02-02")).toEqual([
      "2026-01-30",
      "2026-01-31",
      "2026-02-01",
      "2026-02-02",
    ]);
  });

  it("crosses a leap day", () => {
    expect(expandDateRange("2028-02-27", "2028-03-01")).toEqual([
      "2028-02-27",
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
    ]);
  });

  it("produces the nutrition horizon length (8 weeks inclusive = 57 days)", () => {
    const dates = expandDateRange("2026-04-10", "2026-06-05");
    expect(dates).toHaveLength(57);
    expect(dates[0]).toBe("2026-04-10");
    expect(dates[dates.length - 1]).toBe("2026-06-05");
  });

  describe("timezone neutrality", () => {
    const original = process.env.TZ;
    afterEach(() => {
      process.env.TZ = original;
    });

    // The cascade derives its DELETE bound and its regenerate list from this one
    // helper, so a zone-dependent list would silently desynchronise them. A
    // `new Date(s + "T00:00:00")` step loop drifts a day at large offsets and a
    // parse-UTC/format-local mix loses one west of UTC; this is UTC-anchored end
    // to end, so every zone must agree exactly.
    it.each([
      "UTC",
      "Pacific/Kiritimati", // +14, the largest positive offset
      "Pacific/Auckland", // +12/+13 across DST
      "America/Los_Angeles", // -8
      "America/Sao_Paulo", // -3
      "Asia/Kolkata", // +5:30, a half-hour offset
    ])("is identical under TZ=%s", (tz) => {
      process.env.TZ = tz;
      expect(expandDateRange("2026-01-05", "2026-01-09")).toEqual([
        "2026-01-05",
        "2026-01-06",
        "2026-01-07",
        "2026-01-08",
        "2026-01-09",
      ]);
      // A DST transition inside the range must not duplicate or drop a day.
      expect(expandDateRange("2026-03-28", "2026-03-31")).toEqual([
        "2026-03-28",
        "2026-03-29",
        "2026-03-30",
        "2026-03-31",
      ]);
    });
  });
});
