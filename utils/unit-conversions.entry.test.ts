import { describe, expect, it } from "vitest";
import {
  formatDistance,
  formatDuration,
  formatEntry,
  formatPace,
  formatSplit,
  formatZone,
  METERS_PER_MILE,
  METERS_PER_YARD,
  parseDistance,
  parseDuration,
  parseEntry,
  parsePace,
  parseSplit,
  parseZone,
} from "./unit-conversions";

// The entry grammar every box speaks (CONVENTIONS section 20): what a client
// types, in their own units, and what the box shows back. Nobody types or
// reads a stored unit.

describe("distance", () => {
  it("reads a bare number as kilometres, or miles for an imperial client", () => {
    expect(parseDistance("5", "metric")).toBe(5000);
    expect(parseDistance("5.2", "metric")).toBe(5200);
    expect(parseDistance("3.1", "imperial")).toBe(4988.97);
  });

  it("reads a typed unit as typed, whoever types it", () => {
    for (const viewer of ["metric", "imperial"] as const) {
      expect(parseDistance("400 m", viewer)).toBe(400);
      expect(parseDistance("400m", viewer)).toBe(400);
      expect(parseDistance("5 km", viewer)).toBe(5000);
      expect(parseDistance("800 yd", viewer)).toBe(731.52);
      expect(parseDistance("3.1 mi", viewer)).toBe(4988.97);
      expect(parseDistance("1 mile", viewer)).toBe(Math.round(METERS_PER_MILE * 100) / 100);
    }
    expect(METERS_PER_YARD * 1760).toBeCloseTo(METERS_PER_MILE, 9);
  });

  it("rejects what is not a distance", () => {
    expect(parseDistance("fast", "metric")).toBeNull();
    expect(parseDistance("5 furlongs", "metric")).toBeNull();
    expect(parseDistance("", "metric")).toBeNull();
  });

  it("reads in metres under a kilometre and kilometres from one up", () => {
    expect(formatDistance(400, "metric")).toBe("400 m");
    expect(formatDistance(999.6, "metric")).toBe("1000 m");
    expect(formatDistance(1000, "metric")).toBe("1 km");
    expect(formatDistance(5200, "metric")).toBe("5.2 km");
    expect(formatDistance(4988.97, "metric")).toBe("4.99 km");
  });

  it("reads in yards under a mile and miles from one up for an imperial client", () => {
    expect(formatDistance(731.52, "imperial")).toBe("800 yd");
    expect(formatDistance(METERS_PER_MILE, "imperial")).toBe("1 mi");
    expect(formatDistance(4988.97, "imperial")).toBe("3.1 mi");
    expect(formatDistance(5000, "imperial")).toBe("3.11 mi");
  });
});

describe("duration", () => {
  it("reads hours and minutes in every form a client would type", () => {
    expect(parseDuration("2:00:00")).toBe(7200);
    expect(parseDuration("1:30:00")).toBe(5400);
    expect(parseDuration("45:00")).toBe(2700);
    expect(parseDuration("0:45")).toBe(45);
    expect(parseDuration("2h")).toBe(7200);
    expect(parseDuration("1h30")).toBe(5400);
    expect(parseDuration("1h 30m")).toBe(5400);
    expect(parseDuration("1.5h")).toBe(5400);
    expect(parseDuration("90 min")).toBe(5400);
    expect(parseDuration("45s")).toBe(45);
    expect(parseDuration("1:02:03.4")).toBe(3723.4);
  });

  it("means minutes by a bare number, so 120 is a two-hour run", () => {
    expect(parseDuration("120")).toBe(7200);
    expect(parseDuration("45")).toBe(2700);
  });

  it("keeps tenths for ergs", () => {
    expect(parseDuration("6:45.3")).toBe(405.3);
  });

  it("rejects what is not a time", () => {
    expect(parseDuration("45:75")).toBeNull();
    expect(parseDuration("1:60:00")).toBeNull();
    expect(parseDuration("soon")).toBeNull();
  });

  it("reads h:mm:ss from an hour up and m:ss below, a tenth kept when there is one", () => {
    expect(formatDuration(7200)).toBe("2:00:00");
    expect(formatDuration(5400)).toBe("1:30:00");
    expect(formatDuration(2700)).toBe("45:00");
    expect(formatDuration(45)).toBe("0:45");
    expect(formatDuration(405.3)).toBe("6:45.3");
    expect(formatDuration(1500.5)).toBe("25:00.5");
    expect(formatDuration(3723.4)).toBe("1:02:03.4");
    expect(formatDuration(86400)).toBe("24:00:00");
  });
});

describe("pace", () => {
  it("reads minutes and seconds per km, or per mile for an imperial client, unless the box says which", () => {
    expect(parsePace("4:45", "metric")).toBe(285);
    expect(parsePace("4:45 /km", "imperial")).toBe(285);
    expect(parsePace("7:39", "imperial")).toBe(285);
    expect(parsePace("7:39 /mi", "metric")).toBe(285);
    expect(parsePace("4:45/km", "metric")).toBe(285);
  });

  it("rejects what is not a pace", () => {
    expect(parsePace("5", "metric")).toBeNull();
    expect(parsePace("4:75", "metric")).toBeNull();
    expect(parsePace("quick", "metric")).toBeNull();
  });

  it("reads per km or per mile by the viewer's units", () => {
    expect(formatPace(285, "metric")).toBe("4:45 /km");
    expect(formatPace(285, "imperial")).toBe("7:39 /mi");
    expect(formatPace(300, "imperial")).toBe("8:03 /mi");
  });
});

describe("split", () => {
  it("reads minutes and seconds per 500 m, to a tenth, for everyone", () => {
    expect(parseSplit("1:52.3")).toBe(112.3);
    expect(parseSplit("1:52.3 /500m")).toBe(112.3);
    expect(parseSplit("2:00")).toBe(120);
    expect(parseSplit("1:60")).toBeNull();
    expect(formatSplit(112.3)).toBe("1:52.3 /500m");
    expect(formatSplit(120)).toBe("2:00 /500m");
  });
});

describe("heart-rate zone", () => {
  it("takes the number or Z-number and reads as Z-number", () => {
    expect(parseZone("2")).toBe(2);
    expect(parseZone("Z2")).toBe(2);
    expect(parseZone("z 3")).toBe(3);
    expect(parseZone("zone 2")).toBeNull();
    expect(formatZone(3)).toBe("Z3");
  });
});

describe("parseEntry / formatEntry", () => {
  it("converts a load from the viewer's unit to kilograms to a hundredth, and seeds it unsnapped", () => {
    expect(parseEntry("load", "225", "imperial")).toBe(102.06);
    expect(parseEntry("load", "102.5", "metric")).toBe(102.5);
    expect(formatEntry("load", 100, "imperial")).toBe("220.5");
    expect(formatEntry("load", 102.5, "metric")).toBe("102.5");
  });

  it("passes a number through and refuses a non-number", () => {
    expect(parseEntry("number", "8.25", "metric")).toBe(8.25);
    expect(parseEntry("number", "8,5", "metric")).toBeNull();
    expect(formatEntry("number", 8, "metric")).toBe("8");
  });

  it("returns a tempo as typed, trimmed, and nothing for an empty box", () => {
    expect(parseEntry("tempo", " 3-1-X-0 ", "metric")).toBe("3-1-X-0");
    expect(parseEntry("tempo", "   ", "metric")).toBeNull();
    expect(formatEntry("tempo", "3-1-X-0", "metric")).toBe("3-1-X-0");
  });

  it("every box reads back what it shows", () => {
    const cases: Array<[Parameters<typeof parseEntry>[0], number, "metric" | "imperial"]> = [
      ["distance", 400, "metric"],
      ["distance", 5200, "metric"],
      ["distance", 731.52, "imperial"],
      ["duration", 405.3, "metric"],
      ["duration", 7200, "metric"],
      ["pace", 285, "metric"],
      ["split", 112.3, "metric"],
      ["zone", 3, "metric"],
      ["load", 102.5, "metric"],
      ["number", 90, "metric"],
    ];
    for (const [kind, value, viewer] of cases) {
      expect(parseEntry(kind, formatEntry(kind, value, viewer), viewer), `${kind} ${value}`).toBe(value);
    }
  });
});
