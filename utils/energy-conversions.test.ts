import { describe, it, expect } from "vitest";
import { CALORIES_PER_KG } from "@/lib/constants";
import {
  weeklyRateToDailyDelta,
  dailyDeltaToWeeklyRate,
} from "./energy-conversions";

describe("energy-conversions", () => {
  it("round-trips exactly in both directions", () => {
    for (const rate of [-1.0, -0.75, -0.1, 0, 0.35, 0.5, 1.25]) {
      expect(dailyDeltaToWeeklyRate(weeklyRateToDailyDelta(rate))).toBeCloseTo(rate, 12);
    }
    for (const delta of [-1100, -825, -500, 0, 385, 550]) {
      expect(weeklyRateToDailyDelta(dailyDeltaToWeeklyRate(delta))).toBeCloseTo(delta, 12);
    }
  });

  it("keeps the signed convention: positive = surplus/gain, negative = deficit/loss", () => {
    expect(weeklyRateToDailyDelta(0.5)).toBeGreaterThan(0);
    expect(weeklyRateToDailyDelta(-0.75)).toBeLessThan(0);
    expect(dailyDeltaToWeeklyRate(500)).toBeGreaterThan(0);
    expect(dailyDeltaToWeeklyRate(-500)).toBeLessThan(0);
  });

  it("reproduces the calculator's cap arithmetic bit-for-bit, unrounded", () => {
    // The two safety caps previously inlined (maxWeeklyKg * 7700) / 7; the
    // helper must be the same expression in the same order so the swap in
    // services/nutrition-service.ts changes nothing numerically. toBe (not
    // toBeCloseTo) against the same expression is also the no-rounding proof —
    // display rounding belongs to the renderer.
    expect(weeklyRateToDailyDelta(1.0)).toBe((1.0 * CALORIES_PER_KG) / 7);
    expect(weeklyRateToDailyDelta(0.75)).toBe((0.75 * CALORIES_PER_KG) / 7);
    expect(weeklyRateToDailyDelta(0.5)).toBe((0.5 * CALORIES_PER_KG) / 7);
    expect(weeklyRateToDailyDelta(0.35)).toBe((0.35 * CALORIES_PER_KG) / 7);
    expect(weeklyRateToDailyDelta(1.0)).toBe(1100);
    expect(dailyDeltaToWeeklyRate(-800)).toBe((-800 * 7) / CALORIES_PER_KG);
  });
});
