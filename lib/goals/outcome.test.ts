import { describe, it, expect } from "vitest";
import {
  evaluateGoalOutcome,
  weightToleranceKg,
  WEIGHT_TOLERANCE_KG_FLOOR,
  BODY_FAT_TOLERANCE_PP,
} from "./outcome";

describe("weightToleranceKg", () => {
  it("uses the 1.0 kg floor for small targets", () => {
    // 1.5% of 60 = 0.9 < 1.0 → floor wins.
    expect(weightToleranceKg(60)).toBe(WEIGHT_TOLERANCE_KG_FLOOR);
  });

  it("uses 1.5% for large targets", () => {
    // 1.5% of 100 = 1.5 > 1.0.
    expect(weightToleranceKg(100)).toBeCloseTo(1.5, 5);
  });
});

describe("evaluateGoalOutcome", () => {
  it("inconclusive when there is no weight target", () => {
    expect(
      evaluateGoalOutcome({ startWeightKg: 90, endWeightKg: 85, targetWeightKg: null })
    ).toBe("inconclusive");
  });

  it("inconclusive when there is no end weight to judge", () => {
    expect(
      evaluateGoalOutcome({ startWeightKg: 90, endWeightKg: null, targetWeightKg: 80 })
    ).toBe("inconclusive");
  });

  describe("cut (start > target)", () => {
    it("achieved when end reaches the target", () => {
      expect(
        evaluateGoalOutcome({ startWeightKg: 90, endWeightKg: 80, targetWeightKg: 80 })
      ).toBe("achieved");
    });
    it("achieved when end overshoots past the target (lower)", () => {
      expect(
        evaluateGoalOutcome({ startWeightKg: 90, endWeightKg: 78, targetWeightKg: 80 })
      ).toBe("achieved");
    });
    it("not_achieved when end is still well above the target", () => {
      expect(
        evaluateGoalOutcome({ startWeightKg: 90, endWeightKg: 85, targetWeightKg: 80 })
      ).toBe("not_achieved");
    });
  });

  describe("bulk (start < target)", () => {
    it("achieved when end reaches the target", () => {
      expect(
        evaluateGoalOutcome({ startWeightKg: 70, endWeightKg: 80, targetWeightKg: 80 })
      ).toBe("achieved");
    });
    it("not_achieved when end falls short", () => {
      expect(
        evaluateGoalOutcome({ startWeightKg: 70, endWeightKg: 75, targetWeightKg: 80 })
      ).toBe("not_achieved");
    });
  });

  describe("maintenance (start === target)", () => {
    it("achieved when end stays within tolerance", () => {
      // tolerance for 80 kg = max(1.0, 1.2) = 1.2
      expect(
        evaluateGoalOutcome({ startWeightKg: 80, endWeightKg: 81, targetWeightKg: 80 })
      ).toBe("achieved");
    });
    it("not_achieved when end drifts beyond tolerance", () => {
      expect(
        evaluateGoalOutcome({ startWeightKg: 80, endWeightKg: 83, targetWeightKg: 80 })
      ).toBe("not_achieved");
    });
  });

  describe("weight tolerance boundary", () => {
    it("achieved exactly at the target + tolerance edge (cut)", () => {
      // target 100 → tol 1.5; end 101.5 is exactly target + tol → achieved.
      expect(
        evaluateGoalOutcome({ startWeightKg: 110, endWeightKg: 101.5, targetWeightKg: 100 })
      ).toBe("achieved");
    });
    it("not_achieved just beyond the tolerance edge (cut)", () => {
      expect(
        evaluateGoalOutcome({ startWeightKg: 110, endWeightKg: 101.6, targetWeightKg: 100 })
      ).toBe("not_achieved");
    });
  });

  describe("combined weight + body fat (conjunctive)", () => {
    it("achieved only when BOTH reach target", () => {
      expect(
        evaluateGoalOutcome({
          startWeightKg: 90,
          endWeightKg: 80,
          targetWeightKg: 80,
          startBodyFat: 22,
          endBodyFat: 15,
          targetBodyFat: 15,
        })
      ).toBe("achieved");
    });
    it("not_achieved when weight hits but body fat misses", () => {
      expect(
        evaluateGoalOutcome({
          startWeightKg: 90,
          endWeightKg: 80,
          targetWeightKg: 80,
          startBodyFat: 22,
          endBodyFat: 19, // target 15, tol 1.0 → misses
          targetBodyFat: 15,
        })
      ).toBe("not_achieved");
    });
    it("body fat at the 1.0pp tolerance edge counts as achieved", () => {
      expect(BODY_FAT_TOLERANCE_PP).toBe(1.0);
      expect(
        evaluateGoalOutcome({
          startWeightKg: 90,
          endWeightKg: 80,
          targetWeightKg: 80,
          startBodyFat: 22,
          endBodyFat: 16, // target 15 + 1.0 tol → achieved
          targetBodyFat: 15,
        })
      ).toBe("achieved");
    });
    it("weight-only decides when a body-fat target is set but no end body fat is measured", () => {
      expect(
        evaluateGoalOutcome({
          startWeightKg: 90,
          endWeightKg: 80,
          targetWeightKg: 80,
          targetBodyFat: 15,
          endBodyFat: null,
        })
      ).toBe("achieved");
    });
  });

  it("judges purely on proximity when there is no start weight (no direction)", () => {
    expect(
      evaluateGoalOutcome({ startWeightKg: null, endWeightKg: 80, targetWeightKg: 80 })
    ).toBe("achieved");
    expect(
      evaluateGoalOutcome({ startWeightKg: null, endWeightKg: 85, targetWeightKg: 80 })
    ).toBe("not_achieved");
  });
});
