import { describe, it, expect, vi, afterEach } from "vitest";
import {
  CM_PER_IN,
  KG_PER_LB,
  cmToIn,
  formatHeight,
  formatLength,
  formatLoad,
  formatWeight,
  inToCm,
  kgToLbs,
  lbsToKg,
  parseHeightToCm,
  parseLengthToCm,
  parseWeightToKg,
  toUnitSystem,
} from "./unit-conversions";

describe("conversion constants", () => {
  it("uses the exact international definitions", () => {
    expect(KG_PER_LB).toBe(0.45359237);
    expect(CM_PER_IN).toBe(2.54);
  });
});

describe("lbsToKg / kgToLbs", () => {
  it("converts in both directions", () => {
    expect(lbsToKg(1)).toBe(KG_PER_LB);
    expect(kgToLbs(KG_PER_LB)).toBeCloseTo(1, 10);
    expect(lbsToKg(220.46226218487757)).toBeCloseTo(100, 10);
    expect(kgToLbs(100)).toBeCloseTo(220.462262, 6);
  });

  it("round-trips", () => {
    expect(kgToLbs(lbsToKg(185))).toBeCloseTo(185, 10);
    expect(lbsToKg(kgToLbs(82.3))).toBeCloseTo(82.3, 10);
  });

  it("handles zero and fractional inputs", () => {
    expect(lbsToKg(0)).toBe(0);
    expect(kgToLbs(0)).toBe(0);
    expect(lbsToKg(0.5)).toBeCloseTo(0.226796185, 9);
    expect(kgToLbs(0.5)).toBeCloseTo(1.102311, 6);
  });
});

describe("inToCm / cmToIn", () => {
  it("converts in both directions", () => {
    expect(inToCm(1)).toBe(CM_PER_IN);
    expect(cmToIn(2.54)).toBeCloseTo(1, 10);
    expect(inToCm(32)).toBeCloseTo(81.28, 10);
    expect(cmToIn(81.28)).toBeCloseTo(32, 10);
  });

  it("round-trips", () => {
    expect(cmToIn(inToCm(29.5))).toBeCloseTo(29.5, 10);
    expect(inToCm(cmToIn(178.5))).toBeCloseTo(178.5, 10);
  });

  it("handles zero and fractional inputs", () => {
    expect(inToCm(0)).toBe(0);
    expect(cmToIn(0)).toBe(0);
    expect(inToCm(0.25)).toBeCloseTo(0.635, 10);
    expect(cmToIn(0.5)).toBeCloseTo(0.19685, 5);
  });
});

describe("formatWeight", () => {
  it("returns stored kilograms unchanged for a metric viewer (identity)", () => {
    expect(formatWeight(82.3, "metric")).toEqual({ value: 82.3, unit: "kg" });
    expect(formatWeight(0, "metric")).toEqual({ value: 0, unit: "kg" });
    // Identity means the same number, not a re-derived one.
    expect(formatWeight(47.35, "metric").value).toBe(47.35);
  });

  it("converts to pounds for an imperial viewer", () => {
    const result = formatWeight(82.3, "imperial");
    expect(result.unit).toBe("lbs");
    expect(result.value).toBeCloseTo(181.44, 2);
  });

  it("does not round — the caller owns display precision", () => {
    expect(formatWeight(100, "imperial").value).toBeCloseTo(220.462262, 6);
  });
});

describe("formatLength", () => {
  it("returns stored centimetres unchanged for a metric viewer (identity)", () => {
    expect(formatLength(81.28, "metric")).toEqual({ value: 81.28, unit: "cm" });
    expect(formatLength(0, "metric")).toEqual({ value: 0, unit: "cm" });
  });

  it("converts to decimal inches for an imperial viewer", () => {
    const result = formatLength(81.28, "imperial");
    expect(result.unit).toBe("in");
    expect(result.value).toBeCloseTo(32, 10);
  });

  it("does not round", () => {
    expect(formatLength(85, "imperial").value).toBeCloseTo(33.464567, 6);
  });
});

describe("formatLoad", () => {
  it("snaps an imperial conversion to a loadable multiple of 5 lb", () => {
    const result = formatLoad(100, "imperial");

    expect(result.unit).toBe("lbs");
    // The faithful conversion is 220.46 lbs, which cannot be loaded on a bar.
    expect(result.value).not.toBeCloseTo(220.5, 1);
    expect(result.value % 2.5).toBe(0);
    expect(result.value).toBe(220);
  });

  it("snaps every imperial load, not just round ones", () => {
    for (const kg of [20, 42.5, 60, 77.5, 102.3, 140]) {
      expect(formatLoad(kg, "imperial").value % 2.5).toBe(0);
    }
  });

  // Why the increment is 2.5 rather than the barbell's 5: at 5 lb a light
  // dumbbell reads ~9% under, and a coach's 2.5 kg weekly bump renders as a
  // 10 lb jump against a real 5.5 lb — a progression twice its true size.
  it("keeps light dumbbell loads honest", () => {
    expect(formatLoad(10, "imperial").value).toBe(22.5); // was 20 at a 5 lb snap
    expect(formatLoad(12.5, "imperial").value).toBe(27.5); // was 30
    expect(formatLoad(15, "imperial").value).toBe(32.5); // was 35
  });

  it("renders a 2.5 kg progression as ~5 lb, not ~10", () => {
    const before = formatLoad(10, "imperial").value;
    const after = formatLoad(12.5, "imperial").value;
    expect(after - before).toBe(5);
  });

  it("is indistinguishable from a 5 lb snap at barbell loads", () => {
    expect(formatLoad(100, "imperial").value).toBe(220);
    expect(formatLoad(60, "imperial").value).toBe(132.5);
    expect(formatLoad(140, "imperial").value).toBe(307.5);
  });

  it("passes metric loads through untouched — the identity path", () => {
    // Deliberate deviation from the plan doc's "2.5 kg metric" snap: no
    // conversion happens here, so snapping would rewrite stored data.
    expect(formatLoad(47, "metric")).toEqual({ value: 47, unit: "kg" });
    expect(formatLoad(47.3, "metric").value).toBe(47.3);
    // A logged lift, an Epley e1RM and a session volume total, none of which
    // are plate-quantised numbers.
    expect(formatLoad(102.3, "metric").value).toBe(102.3);
    expect(formatLoad(12347, "metric").value).toBe(12347);
  });

  it("handles zero and fractional inputs", () => {
    expect(formatLoad(0, "metric")).toEqual({ value: 0, unit: "kg" });
    expect(formatLoad(0, "imperial")).toEqual({ value: 0, unit: "lbs" });
    // 1 kg is 2.2 lbs — just above half an increment, so it snaps up to 2.5.
    expect(formatLoad(1, "imperial").value).toBe(2.5);
    expect(formatLoad(0.5, "imperial").value).toBe(0);
    expect(formatLoad(1.5, "imperial").value).toBe(2.5);
  });
});

describe("formatHeight", () => {
  it("returns stored centimetres for a metric viewer", () => {
    expect(formatHeight(180.34, "metric")).toEqual({
      system: "metric",
      value: 180.34,
      unit: "cm",
    });
  });

  it("renders imperial height as feet and whole inches", () => {
    expect(formatHeight(180.34, "imperial")).toEqual({
      system: "imperial",
      feet: 5,
      inches: 11,
    });
    expect(formatHeight(152.4, "imperial")).toEqual({
      system: "imperial",
      feet: 5,
      inches: 0,
    });
  });

  it("carries 12 inches into the next foot — never 5'12\"", () => {
    // 182.85 cm is 71.988 in: rounding the inches alone would produce 5'12".
    expect(formatHeight(182.85, "imperial")).toEqual({
      system: "imperial",
      feet: 6,
      inches: 0,
    });
  });

  it("never reports 12 inches at any height", () => {
    for (let cm = 120; cm <= 220; cm += 0.05) {
      const result = formatHeight(cm, "imperial");
      if (result.system === "imperial") {
        expect(result.inches).toBeLessThan(12);
        expect(result.inches).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("handles zero and fractional inputs", () => {
    expect(formatHeight(0, "metric")).toEqual({
      system: "metric",
      value: 0,
      unit: "cm",
    });
    expect(formatHeight(0, "imperial")).toEqual({
      system: "imperial",
      feet: 0,
      inches: 0,
    });
    expect(formatHeight(175.5, "imperial")).toEqual({
      system: "imperial",
      feet: 5,
      inches: 9,
    });
  });
});

describe("parseWeightToKg", () => {
  it("returns metric input unchanged (identity)", () => {
    expect(parseWeightToKg(82.3, "metric")).toBe(82.3);
    expect(parseWeightToKg(0, "metric")).toBe(0);
  });

  it("converts imperial input to kilograms", () => {
    expect(parseWeightToKg(185, "imperial")).toBeCloseTo(83.9146, 4);
    expect(parseWeightToKg(0, "imperial")).toBe(0);
    expect(parseWeightToKg(0.5, "imperial")).toBeCloseTo(0.226796185, 9);
  });

  it("round-trips through formatWeight", () => {
    const stored = parseWeightToKg(185, "imperial");
    expect(formatWeight(stored, "imperial").value).toBeCloseTo(185, 10);
    expect(formatWeight(parseWeightToKg(82.3, "metric"), "metric").value).toBe(82.3);
  });
});

describe("parseLengthToCm", () => {
  it("returns metric input unchanged (identity)", () => {
    expect(parseLengthToCm(81.28, "metric")).toBe(81.28);
    expect(parseLengthToCm(0, "metric")).toBe(0);
  });

  it("converts imperial input to centimetres", () => {
    expect(parseLengthToCm(32, "imperial")).toBeCloseTo(81.28, 10);
    expect(parseLengthToCm(0.5, "imperial")).toBeCloseTo(1.27, 10);
  });

  it("round-trips through formatLength", () => {
    expect(formatLength(parseLengthToCm(32, "imperial"), "imperial").value).toBeCloseTo(
      32,
      10
    );
  });
});

describe("parseHeightToCm", () => {
  it("passes a centimetre input through", () => {
    expect(parseHeightToCm({ cm: 180.34 })).toBe(180.34);
    expect(parseHeightToCm({ cm: 0 })).toBe(0);
  });

  it("converts feet and inches to centimetres", () => {
    expect(parseHeightToCm({ feet: 5, inches: 11 })).toBeCloseTo(180.34, 10);
    expect(parseHeightToCm({ feet: 6, inches: 0 })).toBeCloseTo(182.88, 10);
    expect(parseHeightToCm({ feet: 0, inches: 0 })).toBe(0);
    expect(parseHeightToCm({ feet: 5, inches: 11.5 })).toBeCloseTo(181.61, 10);
  });

  it("round-trips through formatHeight", () => {
    const stored = parseHeightToCm({ feet: 5, inches: 11 });
    expect(formatHeight(stored, "imperial")).toEqual({
      system: "imperial",
      feet: 5,
      inches: 11,
    });
  });
});

describe("toUnitSystem", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes the two valid values through", () => {
    expect(toUnitSystem("metric")).toBe("metric");
    expect(toUnitSystem("imperial")).toBe("imperial");
  });

  it("defaults a missing value to metric without warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(toUnitSystem(null)).toBe("metric");
    expect(toUnitSystem(undefined)).toBe("metric");

    // null is legitimate — clients.unit_preference is nullable (migration 011).
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns on an unexpected value rather than defaulting silently", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(toUnitSystem("stones")).toBe("metric");
    expect(toUnitSystem("")).toBe("metric");

    expect(warn).toHaveBeenCalledTimes(2);
  });
});
