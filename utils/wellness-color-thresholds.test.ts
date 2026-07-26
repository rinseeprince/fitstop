import { describe, it, expect } from "vitest";
import { getWellnessTone, WELLNESS_TONE_COLOR } from "./wellness-color-thresholds";

describe("getWellnessTone", () => {
  it("has no tone without a value", () => {
    expect(getWellnessTone("mood", null)).toBe("none");
    expect(getWellnessTone("stress", undefined)).toBe("none");
  });

  it("mood reads well from 4 of 5 up", () => {
    expect(getWellnessTone("mood", 3)).toBe("attention");
    expect(getWellnessTone("mood", 4)).toBe("good");
    expect(getWellnessTone("mood", 5)).toBe("good");
  });

  it("energy and sleep read well from 7 of 10 up", () => {
    for (const metric of ["energy", "sleep"] as const) {
      expect(getWellnessTone(metric, 6)).toBe("attention");
      expect(getWellnessTone(metric, 7)).toBe("good");
    }
  });

  it("stress and soreness are inverted — low is the good end", () => {
    for (const metric of ["stress", "soreness"] as const) {
      expect(getWellnessTone(metric, 1)).toBe("good");
      expect(getWellnessTone(metric, 3)).toBe("good");
      expect(getWellnessTone(metric, 4)).toBe("attention");
      expect(getWellnessTone(metric, 9)).toBe("attention");
    }
  });

  it("the same raw number lands on opposite tones across the inversion", () => {
    expect(getWellnessTone("energy", 8)).toBe("good");
    expect(getWellnessTone("stress", 8)).toBe("attention");
    expect(getWellnessTone("energy", 2)).toBe("attention");
    expect(getWellnessTone("soreness", 2)).toBe("good");
  });

  it("tones map to the Teal-Summit pair — teal and warning amber, never red", () => {
    expect(WELLNESS_TONE_COLOR.good).toBe("#0d9488");
    expect(WELLNESS_TONE_COLOR.attention).toBe("#d97706");
  });
});
