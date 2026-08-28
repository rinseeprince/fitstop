import { describe, it, expect, vi } from "vitest";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("./today-service", () => ({ getClientTodayString: vi.fn() }));

import {
  buildAdherenceSummary,
  classifyTrainingDay,
  classifyNutritionDay,
  classifyHabitDay,
  type AdherenceSourceRows,
} from "./client-adherence-service";

describe("classifyTrainingDay", () => {
  it("follows the classification table for single-event days", () => {
    expect(classifyTrainingDay([])).toBe("none");
    expect(classifyTrainingDay(["completed"])).toBe("complete");
    expect(classifyTrainingDay(["partial"])).toBe("partial");
    expect(classifyTrainingDay(["missed"])).toBe("missed");
    expect(classifyTrainingDay(["skipped"])).toBe("missed");
    expect(classifyTrainingDay(["scheduled"])).toBe("no_log");
  });

  it("collapses multi-event days deterministically", () => {
    expect(classifyTrainingDay(["completed", "completed"])).toBe("complete");
    expect(classifyTrainingDay(["completed", "missed"])).toBe("partial");
    expect(classifyTrainingDay(["scheduled", "missed"])).toBe("missed");
    expect(classifyTrainingDay(["scheduled", "scheduled"])).toBe("no_log");
  });
});

describe("classifyNutritionDay", () => {
  it("maps the persisted adherence values and treats absence as no_log", () => {
    expect(classifyNutritionDay("hit")).toBe("complete");
    expect(classifyNutritionDay("partial")).toBe("partial");
    expect(classifyNutritionDay("missed")).toBe("missed");
    expect(classifyNutritionDay(null)).toBe("no_log");
    expect(classifyNutritionDay(undefined)).toBe("no_log");
  });
});

describe("classifyHabitDay", () => {
  it("distinguishes missed (engaged, zero habits) from no_log (no engagement)", () => {
    expect(classifyHabitDay({ eligible: 2, completed: 0, hasSpineRow: true }).dot).toBe("missed");
    expect(classifyHabitDay({ eligible: 2, completed: 0, hasSpineRow: false }).dot).toBe("no_log");
    expect(classifyHabitDay({ eligible: 2, completed: 1, hasSpineRow: false }).dot).toBe("partial");
    expect(classifyHabitDay({ eligible: 2, completed: 2, hasSpineRow: false }).dot).toBe("complete");
  });

  it("carries no signal when no habit is eligible", () => {
    expect(classifyHabitDay({ eligible: 0, completed: 0, hasSpineRow: true })).toEqual({
      dot: "no_log",
      pct: null,
    });
  });
});

/** One nutrition_logs row; every measured column defaults to null. */
const log = (
  date: string,
  nutrition_adherence: string | null,
  values: {
    calories?: number;
    targetCalories?: number;
    protein?: number;
    targetProtein?: number;
  } = {}
): AdherenceSourceRows["nutritionLogs"][number] => ({
  date,
  nutrition_adherence,
  calories_consumed: values.calories ?? null,
  protein_g: values.protein ?? null,
  target_calories: values.targetCalories ?? null,
  target_protein_g: values.targetProtein ?? null,
});

describe("buildAdherenceSummary", () => {
  const dates = ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23"];

  const fixture: AdherenceSourceRows = {
    dates,
    trainingEvents: [
      { date: "2026-07-20", status: "completed" },
      { date: "2026-07-21", status: "missed" },
      // no event on the 22nd → 'none'
      { date: "2026-07-23", status: "scheduled" },
    ],
    nutritionLogs: [
      log("2026-07-20", "hit", { calories: 2000, targetCalories: 2000, protein: 150, targetProtein: 150 }),
      log("2026-07-21", "partial", { calories: 2200, targetCalories: 2000, protein: 130, targetProtein: 150 }),
      // Logged before a plan existed: intake recorded, no target snapshotted.
      log("2026-07-22", null, { calories: 3000, protein: 90 }),
      // no row on the 23rd
    ],
    habits: [
      { id: "h1", name: "Water", effective_date: "2026-07-01" },
      { id: "h2", name: "Steps", effective_date: "2026-07-22" }, // becomes eligible mid-window
    ],
    habitLogs: [
      { date: "2026-07-20", daily_habit_id: "h1", completed: true },
      { date: "2026-07-21", daily_habit_id: "h1", completed: false },
      { date: "2026-07-22", daily_habit_id: "h1", completed: true },
      { date: "2026-07-22", daily_habit_id: "h2", completed: false },
      { date: "2026-07-23", daily_habit_id: "stale-habit", completed: true }, // inactive habit → ignored
    ],
    spineDates: ["2026-07-20", "2026-07-21", "2026-07-22"],
  };

  it("builds the three rails on the shared date axis", () => {
    const summary = buildAdherenceSummary(fixture);

    expect(summary.dates).toEqual(dates);
    expect(summary.training.rail).toEqual(["complete", "missed", "none", "no_log"]);
    expect(summary.nutrition.rail).toEqual(["complete", "partial", "no_log", "no_log"]);
    // 20th: 1/1 complete · 21st: 0/1 with spine row → missed ·
    // 22nd: 1/2 → partial · 23rd: 0/2, no spine row → no_log
    expect(summary.habits.rail).toEqual(["complete", "missed", "partial", "no_log"]);
  });

  it("computes the training numbers over events (full completions only)", () => {
    const summary = buildAdherenceSummary(fixture);
    expect(summary.training).toMatchObject({ completed: 1, planned: 3, pct: 33 });
  });

  it("computes nutrition pct as onTarget over the whole window", () => {
    const summary = buildAdherenceSummary(fixture);
    // 1 hit over 4 window days = 25%; loggedDays counts classified days only
    expect(summary.nutrition).toMatchObject({ onTarget: 1, loggedDays: 2, pct: 25 });
  });

  it("averages intake against the target that applied on the SAME days", () => {
    const summary = buildAdherenceSummary(fixture);
    // The 22nd has intake but no snapshotted target, so it is excluded from
    // BOTH means — including it in the intake alone would compare an average
    // over three days with a target averaged over two.
    expect(summary.nutrition.calories).toEqual({ actual: 2100, target: 2000, days: 2 });
    expect(summary.nutrition.protein).toEqual({ actual: 140, target: 150, days: 2 });
  });

  it("counts the averaged days separately from loggedDays", () => {
    const summary = buildAdherenceSummary(fixture);
    // Three rows carry intake, two carry a target — the panel must not label
    // the mean with the wrong day count.
    expect(summary.nutrition.loggedDays).toBe(2);
    expect(summary.nutrition.calories?.days).toBe(2);
  });

  it("returns null averages when no day recorded both halves", () => {
    const noTargets = buildAdherenceSummary({
      ...fixture,
      nutritionLogs: [log("2026-07-20", "hit", { calories: 2000, protein: 150 })],
    });
    expect(noTargets.nutrition.calories).toBeNull();
    expect(noTargets.nutrition.protein).toBeNull();
  });

  it("averages calories and protein over independent day sets", () => {
    // A row can snapshot a calorie target without a protein one.
    const partial = buildAdherenceSummary({
      ...fixture,
      nutritionLogs: [
        log("2026-07-20", "hit", { calories: 2000, targetCalories: 2000, protein: 150, targetProtein: 150 }),
        log("2026-07-21", "hit", { calories: 2400, targetCalories: 2000 }),
      ],
    });
    expect(partial.nutrition.calories).toEqual({ actual: 2200, target: 2000, days: 2 });
    expect(partial.nutrition.protein).toEqual({ actual: 150, target: 150, days: 1 });
  });

  it("breaks habits down per habit, over each one's OWN eligible days", () => {
    const summary = buildAdherenceSummary(fixture);

    expect(summary.habits.perHabit).toEqual([
      {
        id: "h1",
        name: "Water",
        eligibleDays: 4,
        completedDays: 2,
        pct: 50,
        rail: [true, false, true, false],
      },
      {
        id: "h2",
        name: "Steps",
        // Eligible from the 22nd only — the two days before it existed are
        // null, not misses, so its 0% is over two days rather than four.
        eligibleDays: 2,
        completedDays: 0,
        pct: 0,
        rail: [null, null, false, false],
      },
    ]);
  });

  it("keeps a habit with NO logs in the window, at 0% rather than absent", () => {
    // The whole reason this rides on the adherence read: `logHabit` writes a
    // row only when the client acts, so a habit they ignored for the window has
    // no rows at all and a logs-derived grid would omit it silently — exactly
    // the habit a coach needs to see.
    const summary = buildAdherenceSummary({
      ...fixture,
      habits: [{ id: "h3", name: "Sleep 7h+", effective_date: "2026-07-01" }],
      habitLogs: [],
    });

    expect(summary.habits.perHabit).toEqual([
      {
        id: "h3",
        name: "Sleep 7h+",
        eligibleDays: 4,
        completedDays: 0,
        pct: 0,
        rail: [false, false, false, false],
      },
    ]);
  });

  it("reports pct as null for a habit that was never eligible in the window", () => {
    const summary = buildAdherenceSummary({
      ...fixture,
      habits: [{ id: "h4", name: "Stretch", effective_date: "2026-08-01" }],
      habitLogs: [],
    });

    expect(summary.habits.perHabit[0].pct).toBeNull();
    expect(summary.habits.perHabit[0].rail).toEqual([null, null, null, null]);
  });

  it("computes habit avgPct over eligible days and daysBelow50 via the shipped threshold", () => {
    const summary = buildAdherenceSummary(fixture);
    // day pcts: 100, 0, 50, 0 → avg 38; below-50 days: the two zeros
    expect(summary.habits.avgPct).toBe(38);
    expect(summary.habits.daysBelow50).toBe(2);
  });

  it("returns null percentages when a rail has no signal", () => {
    const empty = buildAdherenceSummary({
      dates,
      trainingEvents: [],
      nutritionLogs: [],
      habits: [],
      habitLogs: [],
      spineDates: [],
    });
    expect(empty.training.pct).toBeNull();
    expect(empty.nutrition.pct).toBeNull();
    expect(empty.nutrition.calories).toBeNull();
    expect(empty.nutrition.protein).toBeNull();
    expect(empty.habits.avgPct).toBeNull();
    expect(empty.training.rail).toEqual(["none", "none", "none", "none"]);
  });
});
