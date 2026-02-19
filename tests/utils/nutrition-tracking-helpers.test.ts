import {
  calculateAdjustedDayTarget,
  calculateAdjustedMacros,
  getCalorieFeedback,
  getNutritionAdherence,
  calculateUnplannedActivityCalories,
  type MacroCalculationResult,
  type CalorieFeedback,
  type NutritionAdherence
} from "@/utils/nutrition-tracking-helpers";

describe("nutrition-tracking-helpers", () => {
  describe("calculateAdjustedDayTarget", () => {
    it("should adjust target with various toggle combinations", () => {
      const baseTarget = 2000;
      
      expect(calculateAdjustedDayTarget(baseTarget, 0, 0, 0, 0, 0)).toBe(2000);
      
      expect(calculateAdjustedDayTarget(baseTarget, 400, 0, 200, 0, 150)).toBe(2750);
      
      expect(calculateAdjustedDayTarget(baseTarget, 400, 300, 200, 100, 0)).toBe(2600);
    });
  });

  describe("calculateAdjustedMacros", () => {
    it("should keep protein fixed when calories change", () => {
      const result = calculateAdjustedMacros(2400, 150, 300, 80);
      
      expect(result.proteinG).toBe(150);
    });

    it("should preserve carb/fat ratio from original plan (balanced)", () => {
      const baseCarbsCal = 300 * 4; 
      const baseFatCal = 80 * 9; 
      const originalRatio = baseCarbsCal / (baseCarbsCal + baseFatCal);
      
      const result = calculateAdjustedMacros(2400, 150, 300, 80);
      
      const newCarbsCal = result.carbsG * 4;
      const newFatCal = result.fatG * 9;
      const newRatio = newCarbsCal / (newCarbsCal + newFatCal);
      
      expect(Math.abs(newRatio - originalRatio)).toBeLessThan(0.05);
    });

    it("should preserve keto split (10/90 carbs/fat)", () => {
      const baseCarbsCal = 25 * 4; 
      const baseFatCal = 167 * 9; 
      const originalRatio = baseCarbsCal / (baseCarbsCal + baseFatCal);
      
      const result = calculateAdjustedMacros(2400, 150, 25, 167);
      
      const newCarbsCal = result.carbsG * 4;
      const newFatCal = result.fatG * 9;
      const newRatio = newCarbsCal / (newCarbsCal + newFatCal);
      
      expect(Math.abs(newRatio - originalRatio)).toBeLessThan(0.02);
    });

    it("should handle edge case when protein calories exceed adjusted total", () => {
      const result = calculateAdjustedMacros(500, 150, 300, 80);
      
      expect(result.proteinG).toBe(150);
      expect(result.carbsG).toBe(0);
      expect(result.fatG).toBe(0);
    });

    it("should handle zero non-protein calories in base", () => {
      const result = calculateAdjustedMacros(2000, 150, 0, 0);
      
      expect(result.proteinG).toBe(150);
      expect(result.carbsG).toBe(0);
      expect(result.fatG).toBe(0);
    });
  });

  describe("getCalorieFeedback", () => {
    it("should return correct color thresholds", () => {
      const target = 2000;
      
      expect(getCalorieFeedback(2000, target).colour).toBe("green");
      expect(getCalorieFeedback(1950, target).colour).toBe("green");
      expect(getCalorieFeedback(2050, target).colour).toBe("green");
      
      expect(getCalorieFeedback(1949, target).colour).toBe("amber");
      expect(getCalorieFeedback(2051, target).colour).toBe("amber");
      expect(getCalorieFeedback(1800, target).colour).toBe("amber");
      expect(getCalorieFeedback(2200, target).colour).toBe("amber");
      
      expect(getCalorieFeedback(1799, target).colour).toBe("red");
      expect(getCalorieFeedback(2201, target).colour).toBe("red");
    });

    it("should calculate direction correctly", () => {
      const target = 2000;
      
      expect(getCalorieFeedback(1800, target).direction).toBe("under");
      expect(getCalorieFeedback(2200, target).direction).toBe("over");
      expect(getCalorieFeedback(2000, target).direction).toBe("exact");
    });

    it("should handle null consumed calories", () => {
      const result = getCalorieFeedback(null, 2000);
      
      expect(result.difference).toBe(2000);
      expect(result.direction).toBe("under");
      expect(result.colour).toBe("green");
    });
  });

  describe("getNutritionAdherence", () => {
    it("should match threshold boundaries", () => {
      const target = 2000;
      
      expect(getNutritionAdherence(1950, target)).toBe("hit");
      expect(getNutritionAdherence(2050, target)).toBe("hit");
      expect(getNutritionAdherence(2000, target)).toBe("hit");
      
      expect(getNutritionAdherence(1949, target)).toBe("partial");
      expect(getNutritionAdherence(2051, target)).toBe("partial");
      expect(getNutritionAdherence(1800, target)).toBe("partial");
      expect(getNutritionAdherence(2200, target)).toBe("partial");
      
      expect(getNutritionAdherence(1799, target)).toBe("missed");
      expect(getNutritionAdherence(2201, target)).toBe("missed");
    });

    it("should return null for null consumed or zero target", () => {
      expect(getNutritionAdherence(null, 2000)).toBeNull();
      expect(getNutritionAdherence(1800, 0)).toBeNull();
    });
  });

  describe("calculateUnplannedActivityCalories", () => {
    it("should calculate calories for different intensities", () => {
      const activity30MinLow = {
        activityName: "Walking",
        intensityLevel: "low" as const,
        durationMinutes: 30
      };
      
      const activity30MinModerate = {
        activityName: "Cycling",
        intensityLevel: "moderate" as const,
        durationMinutes: 30
      };
      
      const activity30MinVigorous = {
        activityName: "Running",
        intensityLevel: "vigorous" as const,
        durationMinutes: 30
      };
      
      const lowCals = calculateUnplannedActivityCalories(activity30MinLow);
      const moderateCals = calculateUnplannedActivityCalories(activity30MinModerate);
      const vigorousCals = calculateUnplannedActivityCalories(activity30MinVigorous);
      
      expect(lowCals).toBeLessThan(moderateCals);
      expect(moderateCals).toBeLessThan(vigorousCals);
      
      expect(lowCals).toBeCloseTo(123, 0);
      expect(moderateCals).toBeCloseTo(210, 0);
      expect(vigorousCals).toBeCloseTo(298, 0);
    });
  });
});