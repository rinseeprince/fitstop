import { describe, expect, it } from "vitest";
import { formatEntryRange, parseEntryRange } from "./target-range";
import { SET_SPEC_MEASURES } from "./exercise-set-specs";
import { METERS_PER_MILE } from "./unit-conversions";

// A range of unit-bearing entries — the builder's distance, duration, pace,
// split and zone boxes — in the grammar every box speaks (CONVENTIONS section
// 20), at each end, typed and read in the viewer's units.

const DISTANCE = SET_SPEC_MEASURES.distance;
const DURATION = SET_SPEC_MEASURES.duration;
const PACE = SET_SPEC_MEASURES.pace;
const SPLIT = SET_SPEC_MEASURES.split;
const ZONE = SET_SPEC_MEASURES.heart_rate_zone;

describe("parseEntryRange", () => {
  it("reads one entry as a collapsed pair, in the viewer's units", () => {
    expect(parseEntryRange("distance", "5", "metric", DISTANCE)).toEqual({ min: 5000, max: 5000 });
    expect(parseEntryRange("distance", "5", "imperial", DISTANCE)).toEqual({
      min: Math.round(5 * METERS_PER_MILE * 100) / 100,
      max: Math.round(5 * METERS_PER_MILE * 100) / 100,
    });
    expect(parseEntryRange("duration", "25:00", "metric", DURATION)).toEqual({ min: 1500, max: 1500 });
    expect(parseEntryRange("pace", "4:45", "metric", PACE)).toEqual({ min: 285, max: 285 });
    expect(parseEntryRange("zone", "Z2", "metric", ZONE)).toEqual({ min: 2, max: 2 });
  });

  it("reads a range, sharing a unit written once on the right end", () => {
    expect(parseEntryRange("distance", "400-800 m", "metric", DISTANCE)).toEqual({ min: 400, max: 800 });
    expect(parseEntryRange("distance", "400-800 m", "imperial", DISTANCE)).toEqual({ min: 400, max: 800 });
    expect(parseEntryRange("distance", "5-6", "metric", DISTANCE)).toEqual({ min: 5000, max: 6000 });
    expect(parseEntryRange("duration", "45-60s", "metric", DURATION)).toEqual({ min: 45, max: 60 });
    expect(parseEntryRange("duration", "2:00-2:30", "metric", DURATION)).toEqual({ min: 120, max: 150 });
    expect(parseEntryRange("duration", "1h-1h30", "metric", DURATION)).toEqual({ min: 3600, max: 5400 });
    expect(parseEntryRange("pace", "3:45-3:50 /km", "imperial", PACE)).toEqual({ min: 225, max: 230 });
    expect(parseEntryRange("pace", "7:39-8:00", "imperial", PACE)).toEqual({
      min: Math.round((459 * 1000) / METERS_PER_MILE),
      max: Math.round((480 * 1000) / METERS_PER_MILE),
    });
    expect(parseEntryRange("split", "1:52.3-1:55 /500m", "metric", SPLIT)).toEqual({ min: 112.3, max: 115 });
    expect(parseEntryRange("zone", "Z2-Z3", "metric", ZONE)).toEqual({ min: 2, max: 3 });
    expect(parseEntryRange("zone", "2-3", "metric", ZONE)).toEqual({ min: 2, max: 3 });
  });

  it("keeps each end's own unit when both are written", () => {
    expect(parseEntryRange("distance", "800 m-1.2 km", "metric", DISTANCE)).toEqual({ min: 800, max: 1200 });
  });

  it("orders a reversed range, accepts every dash, and clamps into the column's bounds", () => {
    expect(parseEntryRange("distance", "800–400 m", "metric", DISTANCE)).toEqual({ min: 400, max: 800 });
    expect(parseEntryRange("zone", "Z7", "metric", ZONE)).toEqual({ min: 5, max: 5 });
    expect(parseEntryRange("pace", "0:30", "metric", PACE)).toEqual({ min: 60, max: 60 });
  });

  it("keeps a half-open legacy pair editable, and an empty string is an empty range", () => {
    expect(parseEntryRange("distance", "400 m-", "metric", DISTANCE)).toEqual({ min: 400, max: null });
    expect(parseEntryRange("distance", "-800 m", "metric", DISTANCE)).toEqual({ min: null, max: 800 });
    expect(parseEntryRange("distance", "", "metric", DISTANCE)).toEqual({ min: null, max: null });
  });

  it("rejects what isn't a value or a range of that kind", () => {
    expect(parseEntryRange("distance", "far", "metric", DISTANCE)).toBeNull();
    expect(parseEntryRange("distance", "1-2-3", "metric", DISTANCE)).toBeNull();
    expect(parseEntryRange("distance", "-", "metric", DISTANCE)).toBeNull();
    expect(parseEntryRange("pace", "4:75", "metric", PACE)).toBeNull();
    expect(parseEntryRange("zone", "Z2-fast", "metric", ZONE)).toBeNull();
  });
});

describe("formatEntryRange", () => {
  it("shows one entry for a collapsed pair, in the viewer's units", () => {
    expect(formatEntryRange("distance", { min: 5000, max: 5000 }, "metric")).toBe("5 km");
    expect(formatEntryRange("distance", { min: 5000, max: 5000 }, "imperial")).toBe("3.11 mi");
    expect(formatEntryRange("pace", { min: 285, max: 285 }, "imperial")).toBe("7:39 /mi");
    expect(formatEntryRange("duration", { min: 1500, max: 1500 }, "metric")).toBe("25:00");
  });

  it("writes a shared unit once, and each end's own when they differ", () => {
    expect(formatEntryRange("distance", { min: 400, max: 800 }, "metric")).toBe("400-800 m");
    expect(formatEntryRange("distance", { min: 800, max: 1200 }, "metric")).toBe("800 m-1.2 km");
    expect(formatEntryRange("pace", { min: 225, max: 230 }, "metric")).toBe("3:45-3:50 /km");
    expect(formatEntryRange("split", { min: 112.3, max: 115 }, "metric")).toBe("1:52.3-1:55 /500m");
    expect(formatEntryRange("duration", { min: 120, max: 150 }, "metric")).toBe("2:00-2:30");
    expect(formatEntryRange("zone", { min: 2, max: 3 }, "metric")).toBe("Z2-Z3");
  });

  it("leaves the open side of a half-open pair blank, and nothing for nothing", () => {
    expect(formatEntryRange("distance", { min: 400, max: null }, "metric")).toBe("400 m-");
    expect(formatEntryRange("distance", { min: null, max: 800 }, "metric")).toBe("-800 m");
    expect(formatEntryRange("distance", { min: null, max: null }, "metric")).toBe("");
  });

  it("round-trips: what the box shows parses back to the same pair", () => {
    const cases = [
      ["distance", { min: 400, max: 800 }, DISTANCE],
      ["distance", { min: 800, max: 1200 }, DISTANCE],
      ["duration", { min: 120, max: 150 }, DURATION],
      ["duration", { min: 2700, max: 3600 }, DURATION],
      ["pace", { min: 225, max: 230 }, PACE],
      ["split", { min: 112.3, max: 115 }, SPLIT],
      ["zone", { min: 2, max: 3 }, ZONE],
    ] as const;
    for (const viewer of ["metric", "imperial"] as const) {
      for (const [kind, range, bounds] of cases) {
        // Display rounding is lossy for an imperial reader — a pace shown per
        // mile to the second, a distance shown in whole yards — which is why a
        // box's untouched value is resubmitted from its seed, never re-parsed
        // (CONVENTIONS section 20). Within the display's precision it agrees.
        const slack = kind === "pace" ? 1 : kind === "distance" ? 1 : 0.01;
        const parsed = parseEntryRange(kind, formatEntryRange(kind, range, viewer), viewer, bounds);
        expect(parsed).not.toBeNull();
        expect(Math.abs((parsed!.min ?? 0) - (range.min ?? 0))).toBeLessThanOrEqual(slack);
        expect(Math.abs((parsed!.max ?? 0) - (range.max ?? 0))).toBeLessThanOrEqual(slack);
      }
    }
  });
});
