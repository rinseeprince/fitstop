import { describe, it, expect } from "vitest";
import { buildNutritionSummary, summarizeNutritionPeriod } from "../nutrition-period-summary";
import type { NutritionLogRow } from "@/services/schedule-data-service";
import type { NutritionDayTarget } from "@/services/nutrition-days-service";
import type { NutritionDay } from "@/types/schedule";

// --- Fixtures ---

const makeLog = (overrides: Partial<NutritionLogRow> = {}): NutritionLogRow => ({
  date: "2026-03-30",
  caloriesConsumed: 2180,
  proteinG: 155,
  carbsG: 245,
  fatG: 68,
  ...overrides,
});

const target = (
  date: string,
  calories: number,
  macros: { proteinG?: number; carbsG?: number; fatG?: number } = {}
): NutritionDayTarget => ({
  date,
  calories,
  proteinG: macros.proteinG ?? 160,
  carbsG: macros.carbsG ?? 250,
  fatG: macros.fatG ?? 70,
  isTrainingDay: false,
  note: null,
});

const targets = (...entries: NutritionDayTarget[]) =>
  new Map(entries.map((entry) => [entry.date, entry]));

const MONDAY = targets(target("2026-03-30", 2200));

describe("buildNutritionSummary — one row per date", () => {
  it("returns hit when actual is within 50 calories of target", () => {
    const result = buildNutritionSummary(
      ["2026-03-30"],
      [makeLog({ caloriesConsumed: 2180 })], // diff = 20
      MONDAY
    );

    expect(result[0].status).toBe("hit");
    expect(result[0].targetCalories).toBe(2200);
    expect(result[0].actualCalories).toBe(2180);
  });

  it("returns hit at exactly 50 calorie threshold", () => {
    const result = buildNutritionSummary(["2026-03-30"], [makeLog({ caloriesConsumed: 2150 })], MONDAY);
    expect(result[0].status).toBe("hit");
  });

  it("returns partial when actual is within 200 calories of target", () => {
    const result = buildNutritionSummary(["2026-03-30"], [makeLog({ caloriesConsumed: 2100 })], MONDAY);
    expect(result[0].status).toBe("partial");
  });

  it("returns partial at exactly 200 calorie threshold", () => {
    const result = buildNutritionSummary(["2026-03-30"], [makeLog({ caloriesConsumed: 2000 })], MONDAY);
    expect(result[0].status).toBe("partial");
  });

  it("returns missed when actual is more than 200 calories off target", () => {
    const result = buildNutritionSummary(["2026-03-30"], [makeLog({ caloriesConsumed: 1900 })], MONDAY);
    expect(result[0].status).toBe("missed");
  });

  it("returns not_logged when a targeted date has no nutrition log", () => {
    const result = buildNutritionSummary(["2026-03-30"], [], MONDAY);

    expect(result[0].status).toBe("not_logged");
    expect(result[0].targetCalories).toBe(2200);
    expect(result[0].actualCalories).toBeNull();
  });

  // No target outranks everything: a day the coach prescribed nothing for has
  // nothing to judge, logged or not.
  it("returns no_target when no version covers the date, logged or not", () => {
    const unlogged = buildNutritionSummary(["2026-03-30"], [], targets());
    expect(unlogged[0]).toMatchObject({ status: "no_target", targetCalories: null, actualCalories: null });

    const logged = buildNutritionSummary(["2026-03-30"], [makeLog({ caloriesConsumed: 2180 })], targets());
    expect(logged[0]).toMatchObject({ status: "no_target", targetCalories: null, actualCalories: 2180 });
  });

  it("returns not_logged when log has null calories_consumed", () => {
    const result = buildNutritionSummary(["2026-03-30"], [makeLog({ caloriesConsumed: null })], MONDAY);
    expect(result[0].status).toBe("not_logged");
  });

  it("generates full week with mixed statuses, each day against its own computed target", () => {
    const dates = [
      "2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02",
      "2026-04-03", "2026-04-04", "2026-04-05",
    ];

    const logs: NutritionLogRow[] = [
      makeLog({ date: "2026-03-30", caloriesConsumed: 2200 }), // Mon: hit (diff=0)
      makeLog({ date: "2026-03-31", caloriesConsumed: 1850 }), // Tue: partial (diff=150)
      // Wed: not_logged
      makeLog({ date: "2026-04-02", caloriesConsumed: 1500 }), // Thu: missed (diff=500)
      makeLog({ date: "2026-04-03", caloriesConsumed: 2190 }), // Fri: hit (diff=10)
      // Sat: not_logged
      // Sun: not_logged
    ];

    const week = targets(
      target("2026-03-30", 2200),
      target("2026-03-31", 2000),
      target("2026-04-01", 2200),
      target("2026-04-02", 2000),
      target("2026-04-03", 2200),
      target("2026-04-04", 1800),
      target("2026-04-05", 1800)
    );

    const result = buildNutritionSummary(dates, logs, week);

    expect(result).toHaveLength(7);
    expect(result.map((day) => day.status)).toEqual([
      "hit", "partial", "not_logged", "missed", "hit", "not_logged", "not_logged",
    ]);
    expect(result.map((day) => day.targetCalories)).toEqual([2200, 2000, 2200, 2000, 2200, 1800, 1800]);
  });

  it("populates macro fields from the log (actual) and the computed day (target)", () => {
    const result = buildNutritionSummary(
      ["2026-03-30"],
      [makeLog({ proteinG: 155, carbsG: 245, fatG: 68 })],
      MONDAY
    );

    expect(result[0].targetProteinG).toBe(160);
    expect(result[0].targetCarbsG).toBe(250);
    expect(result[0].targetFatG).toBe(70);
    expect(result[0].actualProteinG).toBe(155);
    expect(result[0].actualCarbsG).toBe(245);
    expect(result[0].actualFatG).toBe(68);
  });

  // A logged day's target is the computed day's, the same source as an
  // unlogged day's — the log row is read for its meals alone.
  it("a logged day and an unlogged day take their target from the same computed source, never the row", () => {
    const week = targets(target("2026-03-30", 2300), target("2026-03-31", 2300));
    const stale: (NutritionLogRow & { targetCalories: number; targetProteinG: number })[] = [
      { ...makeLog({ date: "2026-03-30", caloriesConsumed: 2290 }), targetCalories: 9999, targetProteinG: 1 },
    ];
    const result = buildNutritionSummary(["2026-03-30", "2026-03-31"], stale, week);

    expect(result[0]).toMatchObject({ targetCalories: 2300, targetProteinG: 160, status: "hit" });
    expect(result[1]).toMatchObject({ targetCalories: 2300, status: "not_logged" });
  });
});

// --- The figures ---

const WEEK = [
  "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08",
  "2026-09-09", "2026-09-10", "2026-09-11",
];

/** The plan's six days of the smoke week: the seventh, today, no version covers. */
const SIX_TARGETS = targets(
  target("2026-09-05", 2300, { proteinG: 170, carbsG: 223, fatG: 81 }),
  target("2026-09-06", 2300, { proteinG: 170, carbsG: 223, fatG: 81 }),
  target("2026-09-07", 2420, { proteinG: 170, carbsG: 239, fatG: 87 }),
  target("2026-09-08", 2420, { proteinG: 170, carbsG: 239, fatG: 87 }),
  target("2026-09-09", 2200, { proteinG: 170, carbsG: 209, fatG: 76 }),
  target("2026-09-10", 2420, { proteinG: 170, carbsG: 239, fatG: 87 })
);

/** A log that matches the day's target to the gram. */
const logAt = (day: NutritionDayTarget): NutritionLogRow => ({
  date: day.date,
  caloriesConsumed: day.calories,
  proteinG: day.proteinG,
  carbsG: day.carbsG,
  fatG: day.fatG,
});

const days = (logs: NutritionLogRow[], t = SIX_TARGETS): NutritionDay[] => buildNutritionSummary(WEEK, logs, t);

describe("summarizeNutritionPeriod — three day sets, each figure over its own", () => {
  // The smoke that found the defect (owner, 2026-09-11): the plan deleted from
  // today, six days logged on target and today logged with nothing to hit.
  // Every surface used to count today against the client, three different
  // ways. It is logged, and nothing else.
  it("a logged day with no target is counted as logged and is in no ratio", () => {
    const summary = summarizeNutritionPeriod(
      days([
        ...[...SIX_TARGETS.values()].map(logAt),
        { date: "2026-09-11", caloriesConsumed: 2100, proteinG: 190, carbsG: 200, fatG: 37 },
      ])
    );

    expect(summary).toMatchObject({
      periodDays: 7,
      loggedDays: 7,
      targetedDays: 6,
      judgedDays: 6,
      loggedNoTargetDays: 1,
      onTarget: 6,
      over: 0,
      under: 0,
      daysOnTargetPct: 100,
      calorieAdherencePct: 100,
      periodVerdict: "hit",
      netCaloriesOnJudgedDays: 0,
    });
    expect(summary.targetTotals?.calories).toBe(14060);
    expect(summary.consumedOnTargetedDays?.calories).toBe(14060);
    // Like for like: the target that applied on the very days it averages —
    // 170 g on every one of them, never 1020 over seven.
    expect(summary.perJudgedDay).toEqual({
      consumed: { calories: 2343, proteinG: 170, carbsG: 229, fatG: 83 },
      target: { calories: 2343, proteinG: 170, carbsG: 229, fatG: 83 },
    });
    // What they ate, every logged day — the seventh included.
    expect(summary.intakePerLoggedDay).toEqual({ calories: 2309, proteinG: 173, carbsG: 225, fatG: 77 });
  });

  it("one logged day and no plan: nothing to judge, so no ratio and no verdict — never 0 of 7", () => {
    const summary = summarizeNutritionPeriod(
      days([{ date: "2026-09-11", caloriesConsumed: 2100, proteinG: 190, carbsG: 200, fatG: 37 }], targets())
    );

    expect(summary).toMatchObject({
      loggedDays: 1,
      targetedDays: 0,
      judgedDays: 0,
      loggedNoTargetDays: 1,
      onTarget: 0,
      daysOnTargetPct: null,
      targetTotals: null,
      consumedOnTargetedDays: null,
      calorieAdherencePct: null,
      periodVerdict: null,
      perJudgedDay: null,
      netCaloriesOnJudgedDays: null,
    });
    expect(summary.intakePerLoggedDay?.calories).toBe(2100);
  });

  it("an unlogged targeted day is a miss: in the denominator and the target total, nothing on the intake side", () => {
    // Three of seven prescribed days logged, each on target. The client did
    // not do what they were supposed to on four days; those days count.
    const seven = targets(...WEEK.map((date) => target(date, 2000, { proteinG: 150, carbsG: 200, fatG: 60 })));
    const summary = summarizeNutritionPeriod(
      days(WEEK.slice(0, 3).map((date) => logAt(seven.get(date)!)), seven)
    );

    expect(summary).toMatchObject({
      loggedDays: 3,
      targetedDays: 7,
      judgedDays: 3,
      loggedNoTargetDays: 0,
      onTarget: 3,
      daysOnTargetPct: 43,
      calorieAdherencePct: 42.9,
      periodVerdict: "missed",
    });
    expect(summary.targetTotals?.calories).toBe(14000);
    expect(summary.consumedOnTargetedDays?.calories).toBe(6000);
    // The intake average is over the days with data: 2000, not 857.
    expect(summary.perJudgedDay?.consumed.calories).toBe(2000);
    expect(summary.intakePerLoggedDay?.calories).toBe(2000);
  });

  it("splits the judged days that missed by the side of the target they landed on", () => {
    const summary = summarizeNutritionPeriod(
      days([
        { date: "2026-09-05", caloriesConsumed: 2300, proteinG: null, carbsG: null, fatG: null }, // hit
        { date: "2026-09-06", caloriesConsumed: 2500, proteinG: null, carbsG: null, fatG: null }, // over by 200 (partial)
        { date: "2026-09-07", caloriesConsumed: 1720, proteinG: null, carbsG: null, fatG: null }, // under by 700 (missed)
      ])
    );

    expect(summary).toMatchObject({ onTarget: 1, over: 1, under: 1, netCaloriesOnJudgedDays: -500 });
  });

  it("grades the period's calorie gap against the thresholds scaled by the TARGETED days", () => {
    const seven = targets(...WEEK.map((date) => target(date, 2000)));
    const eaten = (calories: number) =>
      summarizeNutritionPeriod(days(WEEK.map((date) => ({ date, caloriesConsumed: calories, proteinG: null, carbsG: null, fatG: null })), seven));

    expect(eaten(2050).periodVerdict).toBe("hit"); // 350 over 7 days: 50 × 7
    expect(eaten(2100).periodVerdict).toBe("partial"); // 700 over 7 days: within 143 × 7
    expect(eaten(2300).periodVerdict).toBe("missed");
  });

  it("an empty period carries nothing", () => {
    const summary = summarizeNutritionPeriod(days([], targets()));
    expect(summary).toMatchObject({
      periodDays: 7,
      loggedDays: 0,
      targetedDays: 0,
      intakePerLoggedDay: null,
      perJudgedDay: null,
      daysOnTargetPct: null,
    });
  });
});
