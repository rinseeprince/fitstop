import { describe, it, expect } from "vitest";
import { calculateDailyMacros } from "@/utils/nutrition-helpers";
import {
  DEFAULT_SPLIT,
  MACRO_PRESETS,
  applyPreset,
  gramsToCalories,
  gramsToSplit,
  presetOf,
  setGrams,
  splitToGrams,
  splitToThumbs,
  thumbsToSplit,
  type MacroSplit,
} from "./macro-balance";

/** Every whole-percent split, on a 5-point lattice, plus the edges. */
function lattice(step = 5): MacroSplit[] {
  const out: MacroSplit[] = [];
  for (let carbs = 0; carbs <= 100; carbs += step) {
    for (let fat = 0; carbs + fat <= 100; fat += step) {
      out.push({ carbs, fat, protein: 100 - carbs - fat });
    }
  }
  return out;
}

const gap = (calories: number, split: MacroSplit) =>
  Math.abs(gramsToCalories(splitToGrams(calories, split)) - calories);

describe("macro-balance — the invariant", () => {
  // The spec's bound: for any calories and split, |4P + 4C + 9F − kcal| ≤ 9.
  it("holds the calories within 9 kcal for every split and every target", () => {
    for (let calories = 0; calories <= 4200; calories += 37) {
      for (const split of lattice()) {
        expect(gap(calories, split)).toBeLessThanOrEqual(9);
      }
    }
  });

  // The tighter bound the kernel actually delivers: carbs absorb the
  // remainder, so with any carbs at all the gap is one carb rounding. Rounding
  // the three macros independently would leave gaps up to 8.5 kcal — inside
  // the spec's bound and OUTSIDE this one, which is what makes it a test.
  it("holds the calories within one carb gram (2 kcal) whenever the split has carbs", () => {
    for (let calories = 0; calories <= 4200; calories += 37) {
      for (const split of lattice()) {
        if (split.carbs === 0) continue;
        expect(gap(calories, split)).toBeLessThanOrEqual(2);
      }
    }
  });

  it("2,000 kcal at 45 / 25 / 30 sums exactly — the fat rounding lands on the carbs", () => {
    const grams = splitToGrams(2000, { carbs: 45, fat: 25, protein: 30 });
    // Protein 600 kcal = 150 g. Fat 500 kcal = 55.6 g → 56 g = 504 kcal. Carbs
    // take what is left: 896 kcal = 224 g — not the 225 g an independent
    // rounding of 900 kcal would give.
    expect(grams).toEqual({ proteinG: 150, carbG: 224, fatG: 56 });
    expect(gramsToCalories(grams)).toBe(2000);
  });

  it("a split with no carbs has nowhere to absorb into — the gap is the other two roundings, under the 10 kcal belt", () => {
    // 101 kcal at 0 / 50 / 50: protein 12.6 → 13 g, fat 5.6 → 6 g, carbs would
    // be negative and floor at 0.
    const grams = splitToGrams(101, { carbs: 0, fat: 50, protein: 50 });
    expect(grams).toEqual({ proteinG: 13, carbG: 0, fatG: 6 });
    expect(gap(101, { carbs: 0, fat: 50, protein: 50 })).toBeLessThan(10);
  });

  it("zero calories derive zero grams, and a negative or fractional target is treated as its rounded floor", () => {
    expect(splitToGrams(0, DEFAULT_SPLIT)).toEqual({ proteinG: 0, carbG: 0, fatG: 0 });
    expect(splitToGrams(-500, DEFAULT_SPLIT)).toEqual({ proteinG: 0, carbG: 0, fatG: 0 });
    expect(splitToGrams(2000.4, DEFAULT_SPLIT)).toEqual(splitToGrams(2000, DEFAULT_SPLIT));
  });
});

describe("macro-balance — grams to a split", () => {
  it("reads a split off grams in whole percents that sum to 100", () => {
    // 180 / 270 / 67 g = 720 + 1080 + 603 = 2403 kcal → 30 / 45 / 25.
    const split = gramsToSplit({ proteinG: 180, carbG: 270, fatG: 67 });
    expect(split).toEqual({ carbs: 45, fat: 25, protein: 30 });
    expect(split.carbs + split.fat + split.protein).toBe(100);
  });

  it("sums to 100 for any grams — the carbs remainder settles a rounding overflow", () => {
    for (let p = 0; p <= 300; p += 13) {
      for (let f = 0; f <= 200; f += 11) {
        for (let c = 0; c <= 500; c += 37) {
          const split = gramsToSplit({ proteinG: p, carbG: c, fatG: f });
          expect(split.carbs + split.fat + split.protein).toBe(100);
          expect(Math.min(split.carbs, split.fat, split.protein)).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("grams carrying no calories seed the default split, never 0 / 0 / 0", () => {
    expect(gramsToSplit({ proteinG: 0, carbG: 0, fatG: 0 })).toEqual(DEFAULT_SPLIT);
  });

  it("round-trips a split through its own grams at any realistic target", () => {
    for (const calories of [1200, 1850, 2400, 3150]) {
      for (const split of lattice(10)) {
        if (Math.min(split.carbs, split.fat, split.protein) < 10) continue;
        expect(gramsToSplit(splitToGrams(calories, split))).toEqual(split);
      }
    }
  });
});

describe("macro-balance — setGrams holds the calories", () => {
  const start: MacroSplit = { carbs: 45, fat: 25, protein: 30 };

  it("moves the typed macro and rebalances the other two in their current ratio", () => {
    // 240 g protein at 2,400 kcal = 40%. The remaining 60 keeps carbs:fat at
    // 45:25 → 38.6 / 21.4 → 39 / 21.
    const next = setGrams(start, 2400, "protein", 240);
    expect(next).toEqual({ carbs: 39, fat: 21, protein: 40 });
    expect(next.carbs + next.fat + next.protein).toBe(100);
    // And the calories are held: the grams re-derive to the same target.
    expect(gap(2400, next)).toBeLessThanOrEqual(2);
  });

  it("holds the macro being set at its typed grams within one percent of the target", () => {
    const next = setGrams(start, 2400, "fat", 80); // 720 kcal = 30%
    expect(next.fat).toBe(30);
    expect(splitToGrams(2400, next).fatG).toBe(80);
  });

  it("rebalances carbs — not protein — when fat is set", () => {
    // The HELD macro is the one typed; the other two move. Setting fat must
    // not hand the remainder to protein alone.
    const next = setGrams({ carbs: 50, fat: 20, protein: 30 }, 2000, "fat", 100); // 900 kcal = 45%
    expect(next.fat).toBe(45);
    // Remaining 55 at the old 50:30 carbs:protein ratio → 34.4 / 20.6.
    expect(next).toEqual({ carbs: 34, fat: 45, protein: 21 });
  });

  it("clamps: grams past the whole target take 100% and leave the other two at 0", () => {
    const next = setGrams(start, 2000, "carbs", 900); // 3,600 kcal of carbs
    expect(next).toEqual({ carbs: 100, fat: 0, protein: 0 });
    expect(setGrams(start, 2000, "protein", -40).protein).toBe(0);
  });

  it("splits the remainder evenly when the other two have no ratio to keep", () => {
    const next = setGrams({ carbs: 0, fat: 0, protein: 100 }, 2000, "protein", 150); // 30%
    expect(next).toEqual({ carbs: 35, fat: 35, protein: 30 });
  });

  it("is a no-op with no calories to divide by", () => {
    expect(setGrams(start, 0, "protein", 150)).toEqual(start);
    expect(setGrams(start, -1, "protein", 150)).toEqual(start);
  });
});

describe("macro-balance — presets are the calculator's diet types", () => {
  it("applying a preset holds protein and re-splits the rest exactly as calculateDailyMacros does", () => {
    for (const preset of MACRO_PRESETS) {
      for (const calories of [1600, 2000, 2400, 3000]) {
        const proteinG = Math.round((calories * 0.3) / 4); // 30% protein
        const split = applyPreset({ carbs: 50, fat: 20, protein: 30 }, preset);
        const grams = splitToGrams(calories, split);
        const calc = calculateDailyMacros(calories, proteinG, false, preset);
        expect(split.protein).toBe(30);
        expect(grams.proteinG).toBe(calc.proteinG);
        // The preset works in whole percents of the TOTAL, the calculator in
        // fractions of the remainder — one percent of the target apart at most.
        expect(Math.abs(grams.carbG - calc.carbsG) * 4).toBeLessThanOrEqual(calories / 100 + 2);
        expect(Math.abs(grams.fatG - calc.fatG) * 9).toBeLessThanOrEqual(calories / 100 + 5);
      }
    }
  });

  it("names the preset a split matches, and custom when none does", () => {
    expect(presetOf(applyPreset({ carbs: 0, fat: 0, protein: 30 }, "keto"))).toBe("keto");
    expect(presetOf({ carbs: 35, fat: 35, protein: 30 })).toBe("balanced");
    expect(presetOf({ carbs: 45, fat: 25, protein: 30 })).toBe("custom");
    expect(presetOf({ carbs: 50, fat: 20, protein: 30 })).toBe("custom");
  });

  it("keto at 30% protein is 7 / 63 / 30", () => {
    expect(applyPreset({ carbs: 45, fat: 25, protein: 30 }, "keto")).toEqual({
      carbs: 7,
      fat: 63,
      protein: 30,
    });
  });
});

describe("macro-balance — the two thumbs are the two boundaries", () => {
  it("carbs | fat | protein, left to right", () => {
    expect(splitToThumbs({ carbs: 45, fat: 25, protein: 30 })).toEqual([45, 70]);
    expect(thumbsToSplit([45, 70])).toEqual({ carbs: 45, fat: 25, protein: 30 });
  });

  it("round-trips every split on the lattice", () => {
    for (const split of lattice()) {
      expect(thumbsToSplit(splitToThumbs(split))).toEqual(split);
    }
  });

  it("clamps the thumbs to 0–100 and reads a crossed pair as no fat", () => {
    expect(thumbsToSplit([-5, 120])).toEqual({ carbs: 0, fat: 100, protein: 0 });
    expect(thumbsToSplit([60, 40])).toEqual({ carbs: 60, fat: 0, protein: 40 });
    expect(thumbsToSplit([])).toEqual({ carbs: 0, fat: 0, protein: 100 });
  });
});
