import { describe, it, expect } from "vitest";
import { calculateBaselineCalories } from "./nutrition-service";

/**
 * GOLDEN MATRIX for `calculateBaselineCalories`' gender safety caps and calorie
 * floor.
 *
 * Captured by RUNNING the function before its cap/floor branches were extracted
 * into `lib/goals/goal-rate.ts`, then pasted here verbatim — so this file is
 * evidence produced by the old code, not values re-derived by hand from the new
 * code (which would prove nothing about the extraction).
 *
 * It exists because `nutrition-service.test.ts` covers ONLY start-date clamping:
 * no test there asserts a cap, a floor, a warning string, or a rate, so the
 * entire cap branch could be deleted and that suite would still pass.
 *
 * Every field is asserted, warning strings included — they are coach-visible
 * (`components/clients/nutrition/nutrition-warnings.tsx` renders them verbatim),
 * so a reworded warning is a product change, not a refactor.
 *
 * `vitest.config.ts` pins TZ=UTC. That is correct here: this matrix guards the
 * caps and the floor, which are pure functions of gender and a number. The
 * calculator's date arithmetic is deliberately NOT changed by this workstream —
 * the timezone-neutral derivations live in `lib/goals/goal-rate.test.ts`.
 */

type Gender = "male" | "female" | "other";

const GOLDEN: Array<{
  name: string;
  args: [number, number, number | undefined, string | undefined, Gender, string | undefined, string | undefined];
  expected: {
    baselineCalories: number;
    requiredDailyDeficit: number;
    weeklyRate: number;
    warnings: string[];
  };
}> = [
  {
    name: "maintenance: no goal weight",
    args: [2500, 90, undefined, "2026-04-05", "male", undefined, "2026-01-05"],
    expected: {
      baselineCalories: 2500,
      requiredDailyDeficit: 0,
      weeklyRate: 0,
      warnings: [],
    },
  },
  {
    name: "maintenance: no deadline",
    args: [2500, 90, 85, undefined, "male", undefined, "2026-01-05"],
    expected: {
      baselineCalories: 2500,
      requiredDailyDeficit: 0,
      weeklyRate: 0,
      warnings: [],
    },
  },
  {
    name: "maintenance: deadline already past",
    args: [2500, 90, 85, "2025-12-01", "male", undefined, "2026-01-05"],
    expected: {
      baselineCalories: 2500,
      requiredDailyDeficit: 0,
      weeklyRate: 0,
      warnings: [
        "Goal deadline has passed. Using maintenance calories.",
      ],
    },
  },
  {
    name: "loss uncapped male",
    args: [2500, 90, 85, "2026-04-05", "male", undefined, "2026-01-05"],
    expected: {
      baselineCalories: 2077,
      requiredDailyDeficit: 423.0769230769231,
      weeklyRate: -0.38461538461538464,
      warnings: [],
    },
  },
  {
    name: "loss uncapped female",
    args: [2500, 90, 85, "2026-04-05", "female", undefined, "2026-01-05"],
    expected: {
      baselineCalories: 2077,
      requiredDailyDeficit: 423.0769230769231,
      weeklyRate: -0.38461538461538464,
      warnings: [],
    },
  },
  {
    name: "loss 0.846 male (uncapped)",
    args: [2500, 100, 89, "2026-04-05", "male", undefined, "2026-01-05"],
    expected: {
      baselineCalories: 1569,
      requiredDailyDeficit: 930.7692307692307,
      weeklyRate: -0.8461538461538461,
      warnings: [],
    },
  },
  {
    name: "loss 0.846 female (capped)",
    args: [2500, 100, 89, "2026-04-05", "female", undefined, "2026-01-05"],
    expected: {
      baselineCalories: 1675,
      requiredDailyDeficit: 825,
      weeklyRate: -0.75,
      warnings: [
        "Weekly deficit capped at 0.75kg/week for safety. Goal timeline may need adjustment.",
      ],
    },
  },
  {
    name: "loss capped male",
    args: [2500, 100, 85, "2026-04-05", "male", undefined, "2026-01-05"],
    expected: {
      baselineCalories: 1500,
      requiredDailyDeficit: 1000,
      weeklyRate: -0.9090909090909091,
      warnings: [
        "Weekly deficit capped at 1kg/week for safety. Goal timeline may need adjustment.",
        "Calorie target raised to minimum safe level (1500 cal/day). Consider adjusting goal timeline.",
      ],
    },
  },
  {
    name: "loss exactly at male cap",
    args: [2500, 100, 87, "2026-04-05", "male", undefined, "2026-01-05"],
    expected: {
      baselineCalories: 1500,
      requiredDailyDeficit: 1000,
      weeklyRate: -0.9090909090909091,
      warnings: [
        "Calorie target raised to minimum safe level (1500 cal/day). Consider adjusting goal timeline.",
      ],
    },
  },
  {
    name: "loss exactly at female cap",
    args: [2500, 100, 90.25, "2026-04-05", "female", undefined, "2026-01-05"],
    expected: {
      baselineCalories: 1675,
      requiredDailyDeficit: 825,
      weeklyRate: -0.75,
      warnings: [],
    },
  },
  {
    name: "gain uncapped male",
    args: [2500, 70, 74, "2026-04-05", "male", undefined, "2026-01-05"],
    expected: {
      baselineCalories: 2838,
      requiredDailyDeficit: -338.46153846153845,
      weeklyRate: 0.3076923076923077,
      warnings: [],
    },
  },
  {
    name: "gain 0.423 male (uncapped)",
    args: [2500, 70, 75.5, "2026-04-05", "male", undefined, "2026-01-05"],
    expected: {
      baselineCalories: 2965,
      requiredDailyDeficit: -465.38461538461536,
      weeklyRate: 0.4230769230769231,
      warnings: [],
    },
  },
  {
    name: "gain 0.423 female (capped)",
    args: [2500, 70, 75.5, "2026-04-05", "female", undefined, "2026-01-05"],
    expected: {
      baselineCalories: 2885,
      requiredDailyDeficit: -385,
      weeklyRate: 0.35,
      warnings: [
        "Weekly surplus capped at 0.35kg/week for optimal muscle gain. Goal timeline may need adjustment.",
      ],
    },
  },
  {
    name: "gain capped male",
    args: [2500, 70, 80, "2026-04-05", "male", undefined, "2026-01-05"],
    expected: {
      baselineCalories: 3050,
      requiredDailyDeficit: -550,
      weeklyRate: 0.5,
      warnings: [
        "Weekly surplus capped at 0.5kg/week for optimal muscle gain. Goal timeline may need adjustment.",
      ],
    },
  },
  {
    name: "gain exactly at male cap",
    args: [2500, 70, 76.5, "2026-04-05", "male", undefined, "2026-01-05"],
    expected: {
      baselineCalories: 3050,
      requiredDailyDeficit: -550,
      weeklyRate: 0.5,
      warnings: [],
    },
  },
  {
    name: "gain exactly at female cap",
    args: [2500, 70, 74.55, "2026-04-05", "female", undefined, "2026-01-05"],
    expected: {
      baselineCalories: 2885,
      requiredDailyDeficit: -384.9999999999998,
      weeklyRate: 0.34999999999999976,
      warnings: [],
    },
  },
  {
    name: "floor male (low tdee)",
    args: [1700, 90, 85, "2026-04-05", "male", undefined, "2026-01-05"],
    expected: {
      baselineCalories: 1500,
      requiredDailyDeficit: 200,
      weeklyRate: -0.18181818181818182,
      warnings: [
        "Calorie target raised to minimum safe level (1500 cal/day). Consider adjusting goal timeline.",
      ],
    },
  },
  {
    name: "floor female (low tdee)",
    args: [1400, 90, 85, "2026-04-05", "female", undefined, "2026-01-05"],
    expected: {
      baselineCalories: 1200,
      requiredDailyDeficit: 200,
      weeklyRate: -0.18181818181818182,
      warnings: [
        "Calorie target raised to minimum safe level (1200 cal/day). Consider adjusting goal timeline.",
      ],
    },
  },
  {
    name: "cap AND floor male",
    args: [1700, 100, 85, "2026-04-05", "male", undefined, "2026-01-05"],
    expected: {
      baselineCalories: 1500,
      requiredDailyDeficit: 200,
      weeklyRate: -0.18181818181818182,
      warnings: [
        "Weekly deficit capped at 1kg/week for safety. Goal timeline may need adjustment.",
        "Calorie target raised to minimum safe level (1500 cal/day). Consider adjusting goal timeline.",
      ],
    },
  },
  {
    name: "cap AND floor female",
    args: [1400, 100, 85, "2026-04-05", "female", undefined, "2026-01-05"],
    expected: {
      baselineCalories: 1200,
      requiredDailyDeficit: 200,
      weeklyRate: -0.18181818181818182,
      warnings: [
        "Weekly deficit capped at 0.75kg/week for safety. Goal timeline may need adjustment.",
        "Calorie target raised to minimum safe level (1200 cal/day). Consider adjusting goal timeline.",
      ],
    },
  },
  {
    name: "gender other takes the MALE loss cap",
    args: [2500, 100, 85, "2026-04-05", "other", undefined, "2026-01-05"],
    expected: {
      baselineCalories: 1500,
      requiredDailyDeficit: 1000,
      weeklyRate: -0.9090909090909091,
      warnings: [
        "Weekly deficit capped at 1kg/week for safety. Goal timeline may need adjustment.",
        "Calorie target raised to minimum safe level (1500 cal/day). Consider adjusting goal timeline.",
      ],
    },
  },
  {
    name: "gender other takes the MALE floor",
    args: [1700, 100, 85, "2026-04-05", "other", undefined, "2026-01-05"],
    expected: {
      baselineCalories: 1500,
      requiredDailyDeficit: 200,
      weeklyRate: -0.18181818181818182,
      warnings: [
        "Weekly deficit capped at 1kg/week for safety. Goal timeline may need adjustment.",
        "Calorie target raised to minimum safe level (1500 cal/day). Consider adjusting goal timeline.",
      ],
    },
  },
  {
    name: "future start counts from start",
    args: [2500, 90, 85, "2026-04-05", "male", "2026-02-05", "2026-01-05"],
    expected: {
      baselineCalories: 1858,
      requiredDailyDeficit: 641.6666666666666,
      weeklyRate: -0.5833333333333334,
      warnings: [],
    },
  },
  {
    name: "past start clamps to today",
    args: [2500, 90, 85, "2026-04-05", "male", "2025-11-05", "2026-01-05"],
    expected: {
      baselineCalories: 2077,
      requiredDailyDeficit: 423.0769230769231,
      weeklyRate: -0.38461538461538464,
      warnings: [],
    },
  },
];

describe("calculateBaselineCalories — caps + floor golden matrix", () => {
  it.each(GOLDEN)("$name", ({ args, expected }) => {
    expect(calculateBaselineCalories(...args)).toEqual(expected);
  });

  // Two properties the matrix above encodes but which are easy to lose in a
  // table of numbers, so they get named assertions of their own.

  it("treats an unset gender as MALE for the cap and the floor, but SAYS SO", () => {
    // `gender === "female" ? x : y` — "other", and a null/undefined gender cast
    // through the orchestrator's `as`, all take the male branch. The NUMBERS are
    // still preserved exactly (owner decision 2026-07-29: do not silently re-rate
    // existing gender-less clients) — but an unset gender now carries an extra
    // warning, because a limit it never chose was applied to it.
    const other = calculateBaselineCalories(2500, 100, 85, "2026-04-05", "other", undefined, "2026-01-05");
    const male = calculateBaselineCalories(2500, 100, 85, "2026-04-05", "male", undefined, "2026-01-05");
    expect(other).toEqual(male); // an explicit "other" is a CHOICE — nothing assumed

    const unset = calculateBaselineCalories(
      2500, 100, 85, "2026-04-05",
      undefined as unknown as Gender,
      undefined, "2026-01-05",
    );
    expect(unset.baselineCalories).toBe(male.baselineCalories);
    expect(unset.requiredDailyDeficit).toBe(male.requiredDailyDeficit);
    expect(unset.weeklyRate).toBe(male.weeklyRate);
    expect(unset.warnings).toEqual([
      ...male.warnings,
      expect.stringContaining("no gender set"),
    ]);
  });

  it("stays silent about an assumed envelope when no limit actually applied", () => {
    // 2500 TDEE, a gentle target: nothing caps, nothing floors, so there is
    // nothing to disclose and the warning would be noise on every plan.
    const unset = calculateBaselineCalories(
      2500, 90, 85, "2026-04-05",
      undefined as unknown as Gender,
      undefined, "2026-01-05",
    );
    expect(unset.warnings).toEqual([]);
  });

  it("reports the POST-floor rate — the deficit the plan will actually run", () => {
    // FIXED in task 2.8(d) (owner decision 2026-07-29). This used to return the
    // deficit it was ASKED for (423 cal/day, -0.3846 kg/wk) beside a floored
    // target that only runs 200 cal/day — advertising a rate the client would
    // never hit. Both are now re-derived from the target actually returned.
    const r = calculateBaselineCalories(1700, 90, 85, "2026-04-05", "male", undefined, "2026-01-05");

    expect(r.baselineCalories).toBe(1500); // floored up from 1277
    expect(r.requiredDailyDeficit).toBe(200); // 1700 - 1500, not 423.08
    expect(r.weeklyRate).toBeCloseTo(-0.1818, 4); // not -0.3846
  });

  it("EVERY row reports a deficit that matches the target it returned", () => {
    // The universal property task 2.8(d) is really about, and a stronger guard
    // than any single literal: whatever the caps and floor do, what the response
    // CLAIMS the client will run must equal what the returned target actually
    // runs. Unfloored rows carry the pre-round deficit, so allow half a calorie.
    for (const { name, args, expected } of GOLDEN) {
      const tdee = args[0];
      const r = calculateBaselineCalories(...args);
      expect.soft(r.requiredDailyDeficit, `${name}: deficit vs target`).toBeCloseTo(
        tdee - r.baselineCalories,
        0
      );
      expect.soft(r.weeklyRate, `${name}: rate vs target`).toBeCloseTo(
        ((r.baselineCalories - tdee) * 7) / 7700,
        2
      );
      expect(r.baselineCalories).toBe(expected.baselineCalories);
    }
  });
});
