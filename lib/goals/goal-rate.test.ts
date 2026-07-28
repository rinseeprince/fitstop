import { describe, it, expect, afterEach } from "vitest";
import {
  applyCalorieFloor,
  calculateBaselineCaloriesFromRate,
  capWeeklyRate,
  dailyCalorieDeltaFromRate,
  dailyCalorieMagnitudeFromRate,
  daysToDeadline,
  deriveDeadlineFromRate,
  deriveRateFromTarget,
  getRateSafety,
  rateFromDailyCalorieDelta,
} from "./goal-rate";
import { calculateBaselineCalories } from "@/services/nutrition-service";

describe("getRateSafety", () => {
  it("gives female the tighter ceilings and the lower floor", () => {
    expect(getRateSafety("female")).toEqual({
      maxLossKgPerWeek: 0.75,
      maxGainKgPerWeek: 0.35,
      minDailyCalories: 1200,
    });
  });

  it.each(["male", "other", null, undefined] as const)(
    "resolves %s to the male envelope",
    (gender) => {
      expect(getRateSafety(gender)).toEqual({
        maxLossKgPerWeek: 1.0,
        maxGainKgPerWeek: 0.5,
        minDailyCalories: 1500,
      });
    }
  );
});

describe("rate ⇄ daily calorie delta", () => {
  it("converts a weekly rate to a signed daily delta", () => {
    expect(dailyCalorieDeltaFromRate(-1)).toBe(-1100);
    expect(dailyCalorieDeltaFromRate(0.5)).toBe(550);
    expect(dailyCalorieDeltaFromRate(0)).toBe(0);
  });

  it("round-trips through the inverse", () => {
    for (const rate of [-1, -0.75, -0.3846, 0, 0.35, 0.5]) {
      expect(rateFromDailyCalorieDelta(dailyCalorieDeltaFromRate(rate))).toBeCloseTo(rate, 10);
    }
  });

  it("magnitude drops the sign", () => {
    expect(dailyCalorieMagnitudeFromRate(-0.75)).toBe(825);
    expect(dailyCalorieMagnitudeFromRate(0.75)).toBe(825);
  });
});

describe("capWeeklyRate", () => {
  it("leaves a rate inside the envelope alone", () => {
    const r = capWeeklyRate(-0.5, "male");
    expect(r).toMatchObject({ rateKgPerWeek: -0.5, capped: false, warning: null });
  });

  it("caps a loss past the male ceiling", () => {
    expect(capWeeklyRate(-1.5, "male")).toEqual({
      rateKgPerWeek: -1,
      capped: true,
      capKgPerWeek: 1,
      warning:
        "Weekly deficit capped at 1kg/week for safety. Goal timeline may need adjustment.",
    });
  });

  it("caps a gain past the male ceiling", () => {
    expect(capWeeklyRate(0.8, "male")).toEqual({
      rateKgPerWeek: 0.5,
      capped: true,
      capKgPerWeek: 0.5,
      warning:
        "Weekly surplus capped at 0.5kg/week for optimal muscle gain. Goal timeline may need adjustment.",
    });
  });

  it("caps the same rate for a woman that it passes for a man", () => {
    // -0.846 kg/wk: inside the 1.0 male ceiling, outside the 0.75 female one.
    expect(capWeeklyRate(-0.846, "male").capped).toBe(false);
    expect(capWeeklyRate(-0.846, "female")).toMatchObject({
      rateKgPerWeek: -0.75,
      capped: true,
    });
  });

  it("does not cap a rate sitting exactly ON the ceiling", () => {
    // The comparison is strict (`< -max`), so the boundary passes through. Same
    // boundary the deadline-driven calculator has always had.
    expect(capWeeklyRate(-1, "male").capped).toBe(false);
    expect(capWeeklyRate(0.5, "male").capped).toBe(false);
    expect(capWeeklyRate(-0.75, "female").capped).toBe(false);
  });
});

describe("applyCalorieFloor", () => {
  it("raises a target below the gender minimum", () => {
    expect(applyCalorieFloor(900, "female")).toEqual({
      calories: 1200,
      floored: true,
      floor: 1200,
      warning:
        "Calorie target raised to minimum safe level (1200 cal/day). Consider adjusting goal timeline.",
    });
  });

  it("leaves a target at or above the minimum alone", () => {
    expect(applyCalorieFloor(1500, "male")).toMatchObject({ calories: 1500, floored: false });
    expect(applyCalorieFloor(2200, "male")).toMatchObject({ calories: 2200, floored: false });
  });
});

describe("daysToDeadline", () => {
  it("counts inclusively", () => {
    // 5 Jan → 5 Apr is 90 days apart and 91 days inclusive.
    expect(daysToDeadline({ today: "2026-01-05", deadline: "2026-04-05" })).toBe(91);
    expect(daysToDeadline({ today: "2026-01-05", deadline: "2026-01-05" })).toBe(1);
  });

  it("counts from a future start rather than today", () => {
    expect(
      daysToDeadline({ today: "2026-01-05", startDate: "2026-02-05", deadline: "2026-04-05" })
    ).toBe(60);
  });

  it("clamps an elapsed start back to today", () => {
    expect(
      daysToDeadline({ today: "2026-01-05", startDate: "2025-11-05", deadline: "2026-04-05" })
    ).toBe(91);
  });

  it("goes non-positive once the deadline has passed", () => {
    expect(daysToDeadline({ today: "2026-01-05", deadline: "2025-12-01" })).toBeLessThanOrEqual(0);
  });
});

describe("deriveRateFromTarget ⇄ deriveDeadlineFromRate", () => {
  it("derives the rate a target and deadline imply", () => {
    const r = deriveRateFromTarget({
      currentWeightKg: 90,
      goalWeightKg: 85,
      deadline: "2026-04-05",
      today: "2026-01-05",
    });
    expect(r).not.toBeNull();
    expect(r!.days).toBe(91);
    expect(r!.rateKgPerWeek).toBeCloseTo(-5 / 13, 10);
  });

  it("returns null once the deadline has passed (maintenance, not an error)", () => {
    expect(
      deriveRateFromTarget({
        currentWeightKg: 90,
        goalWeightKg: 85,
        deadline: "2025-12-01",
        today: "2026-01-05",
      })
    ).toBeNull();
  });

  it("round-trips target → rate → deadline", () => {
    const base = { currentWeightKg: 90, goalWeightKg: 85, today: "2026-01-05" };
    const rate = deriveRateFromTarget({ ...base, deadline: "2026-04-05" })!;
    const back = deriveDeadlineFromRate({ ...base, rateKgPerWeek: rate.rateKgPerWeek })!;

    expect(back.deadline).toBe("2026-04-05");
    expect(back.days).toBe(rate.days);
  });

  it("round-trips a gain as well as a loss", () => {
    const base = { currentWeightKg: 70, goalWeightKg: 76, today: "2026-01-05" };
    const rate = deriveRateFromTarget({ ...base, deadline: "2026-06-01" })!;
    expect(deriveDeadlineFromRate({ ...base, rateKgPerWeek: rate.rateKgPerWeek })!.deadline).toBe(
      "2026-06-01"
    );
  });

  it("honours a future start date in both directions", () => {
    const base = {
      currentWeightKg: 90,
      goalWeightKg: 85,
      today: "2026-01-05",
      startDate: "2026-02-05",
    };
    const rate = deriveRateFromTarget({ ...base, deadline: "2026-04-05" })!;
    expect(rate.days).toBe(60);
    expect(deriveDeadlineFromRate({ ...base, rateKgPerWeek: rate.rateKgPerWeek })!.deadline).toBe(
      "2026-04-05"
    );
  });

  it("returns null where no deadline exists", () => {
    const base = { currentWeightKg: 90, goalWeightKg: 85, today: "2026-01-05" };
    // Maintenance never arrives.
    expect(deriveDeadlineFromRate({ ...base, rateKgPerWeek: 0 })).toBeNull();
    // A surplus never reaches a lighter goal.
    expect(deriveDeadlineFromRate({ ...base, rateKgPerWeek: 0.5 })).toBeNull();
    // Already there.
    expect(
      deriveDeadlineFromRate({ ...base, goalWeightKg: 90, rateKgPerWeek: -0.5 })
    ).toBeNull();
  });
});

describe("calculateBaselineCaloriesFromRate", () => {
  it("turns a rate into a calorie target", () => {
    const r = calculateBaselineCaloriesFromRate({ tdee: 2500, rateKgPerWeek: -0.5, gender: "male" });
    expect(r.baselineCalories).toBe(1950); // 2500 - 550
    expect(r.dailyCalorieDelta).toBe(-550);
    expect(r.capped).toBe(false);
    expect(r.floored).toBe(false);
    expect(r.warnings).toEqual([]);
  });

  it("surfaces a cap STRUCTURALLY, not only as prose", () => {
    // TDEE 3000 so the cap fires alone — at 2500 the capped target (1400) would
    // also trip the 1500 floor and this would stop being a cap-only case.
    const r = calculateBaselineCaloriesFromRate({ tdee: 3000, rateKgPerWeek: -1.5, gender: "male" });
    expect(r.capped).toBe(true);
    expect(r.floored).toBe(false);
    expect(r.capKgPerWeek).toBe(1);
    expect(r.requestedRateKgPerWeek).toBe(-1.5);
    expect(r.appliedRateKgPerWeek).toBe(-1);
    expect(r.baselineCalories).toBe(1900); // 3000 - 1100
    expect(r.warnings).toHaveLength(1);
  });

  it("reports the rate the floored target ACTUALLY delivers", () => {
    // The deadline-driven calculator returns a pre-floor rate next to a
    // post-floor calorie target (pinned in nutrition-service.caps-floor.test.ts).
    // Rate-first entry must not repeat that: a per-block preview showing a rate
    // the client cannot hit is exactly what invariant 12 is about.
    const r = calculateBaselineCaloriesFromRate({ tdee: 1700, rateKgPerWeek: -1, gender: "male" });

    expect(r.floored).toBe(true);
    expect(r.baselineCalories).toBe(1500); // floored up from 600
    expect(r.requestedRateKgPerWeek).toBe(-1);
    // 1700 - 1500 = 200/day ⇒ 0.18 kg/wk, not the 1.0 that was asked for.
    expect(r.appliedRateKgPerWeek).toBeCloseTo(-0.1818, 4);
  });

  it("reports a cap and a floor together", () => {
    const r = calculateBaselineCaloriesFromRate({ tdee: 1700, rateKgPerWeek: -2, gender: "female" });
    expect(r.capped).toBe(true);
    expect(r.floored).toBe(true);
    expect(r.warnings).toHaveLength(2);
  });
});

describe("agreement with the deadline-driven calculator", () => {
  it("derives the same weekly rate the calculator does", () => {
    // Same inputs, both directions of the same model. `vitest.config.ts` pins
    // TZ=UTC, which is where the calculator's mixed local/UTC date parse happens
    // to be correct — see the timezone block below for why this module does not
    // reuse that arithmetic.
    const args = {
      tdee: 2500,
      currentWeightKg: 90,
      goalWeightKg: 85,
      deadline: "2026-04-05",
      today: "2026-01-05",
    };
    const fromCalculator = calculateBaselineCalories(
      args.tdee,
      args.currentWeightKg,
      args.goalWeightKg,
      args.deadline,
      "male",
      undefined,
      args.today
    );
    const fromRate = deriveRateFromTarget(args)!;

    expect(fromRate.rateKgPerWeek).toBeCloseTo(fromCalculator.weeklyRate, 10);

    // And feeding that rate back reproduces the calculator's calorie target.
    const roundTrip = calculateBaselineCaloriesFromRate({
      tdee: args.tdee,
      rateKgPerWeek: fromRate.rateKgPerWeek,
      gender: "male",
    });
    expect(roundTrip.baselineCalories).toBe(fromCalculator.baselineCalories);
  });
});

describe("timezone neutrality", () => {
  const original = process.env.TZ;
  afterEach(() => {
    process.env.TZ = original;
  });

  // Session 3 renders this module in the COACH'S BROWSER, where TZ is their
  // device zone rather than the server's UTC. The deadline-driven calculator
  // parses `today` as LOCAL midnight and the deadline as UTC midnight, and
  // Math.round absorbs the offset only below ±12h — so a transcription of it
  // drifts a day at +12 and beyond. This module uses day numbers instead, and
  // these cases are the evidence that the choice matters.
  const ZONES = [
    "UTC",
    "Pacific/Kiritimati", // +14
    "Pacific/Auckland", // +12 / +13
    "America/Los_Angeles", // -8
    "America/Sao_Paulo", // -3
    "Asia/Kolkata", // +5:30
  ];

  it.each(ZONES)("counts the same number of days under TZ=%s", (tz) => {
    process.env.TZ = tz;
    expect(daysToDeadline({ today: "2026-01-05", deadline: "2026-04-05" })).toBe(91);
  });

  it.each(ZONES)("emits the same deadline string under TZ=%s", (tz) => {
    process.env.TZ = tz;
    const r = deriveDeadlineFromRate({
      currentWeightKg: 90,
      goalWeightKg: 85,
      rateKgPerWeek: -5 / 13,
      today: "2026-01-05",
    });
    // A local-midnight parse emitted via toISOString() returns 2026-04-04 in
    // Auckland; a UTC parse formatted with local getters returns a day early
    // across the Americas. addDaysToDateString is UTC-anchored end to end.
    expect(r!.deadline).toBe("2026-04-05");
  });

  it("stays correct at +13 where the calculator's own arithmetic drifts", () => {
    process.env.TZ = "Pacific/Auckland";

    // Verbatim transcription of services/nutrition-service.ts:89-102.
    const now = new Date("2026-01-05T00:00:00"); // LOCAL midnight
    const deadline = new Date("2026-04-05"); // UTC midnight
    const transcribed =
      Math.round((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    expect(transcribed).toBe(92); // wrong by one
    expect(daysToDeadline({ today: "2026-01-05", deadline: "2026-04-05" })).toBe(91); // right
  });

  it("stays correct at exactly +12, where Math.round tips on a .5", () => {
    process.env.TZ = "Pacific/Auckland"; // NZST (+12) in July

    const now = new Date("2026-07-05T00:00:00");
    const deadline = new Date("2026-10-05");
    const transcribed =
      Math.round((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    // The offset fraction is exactly 0.5 and Math.round takes it up.
    expect(transcribed).toBe(94);
    expect(daysToDeadline({ today: "2026-07-05", deadline: "2026-10-05" })).toBe(93);
  });
});
