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
      { date: "2026-07-20", nutrition_adherence: "hit" },
      { date: "2026-07-21", nutrition_adherence: "partial" },
      { date: "2026-07-22", nutrition_adherence: null },
      // no row on the 23rd
    ],
    habits: [
      { id: "h1", effective_date: "2026-07-01" },
      { id: "h2", effective_date: "2026-07-22" }, // becomes eligible mid-window
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
    expect(empty.habits.avgPct).toBeNull();
    expect(empty.training.rail).toEqual(["none", "none", "none", "none"]);
  });
});
