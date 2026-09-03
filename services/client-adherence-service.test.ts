import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("./today-service", () => ({ getClientTodayString: vi.fn() }));

import { supabaseAdmin } from "./supabase-admin";
import {
  buildAdherenceSummary,
  classifyTrainingDay,
  classifyNutritionDay,
  classifyHabitDay,
  getClientAdherenceForRange,
  type AdherenceSourceRows,
} from "./client-adherence-service";

/** A nutrition row that carries a consumed value — a logged day by itself. */
const nut = (date: string, nutrition_adherence: string | null) => ({
  date,
  nutrition_adherence,
  calories_consumed: 2000,
  protein_g: null,
  carbs_g: null,
  fat_g: null,
});

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
  it("distinguishes missed (a logged day, zero habits) from no_log (no log at all)", () => {
    expect(classifyHabitDay({ eligible: 2, completed: 0, logged: true }).dot).toBe("missed");
    expect(classifyHabitDay({ eligible: 2, completed: 0, logged: false }).dot).toBe("no_log");
    expect(classifyHabitDay({ eligible: 2, completed: 1, logged: false }).dot).toBe("partial");
    expect(classifyHabitDay({ eligible: 2, completed: 2, logged: false }).dot).toBe("complete");
  });

  it("carries no signal when no habit is eligible", () => {
    expect(classifyHabitDay({ eligible: 0, completed: 0, logged: true })).toEqual({
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
      nut("2026-07-20", "hit"),
      nut("2026-07-21", "partial"),
      nut("2026-07-22", null),
      // no row on the 23rd
    ],
    habits: [
      { id: "h1", name: "Water", effective_date: "2026-07-01" },
      { id: "h2", name: "Steps", effective_date: "2026-07-22" }, // eligible mid-window
    ],
    habitLogs: [
      { date: "2026-07-20", daily_habit_id: "h1", completed: true },
      { date: "2026-07-21", daily_habit_id: "h1", completed: false },
      { date: "2026-07-22", daily_habit_id: "h1", completed: true },
      { date: "2026-07-22", daily_habit_id: "h2", completed: false },
      { date: "2026-07-22", daily_habit_id: "stale-habit", completed: true }, // inactive habit → ignored
    ],
    wellnessLogs: [],
    clientLogDates: [],
  };

  it("builds the three rails on the shared date axis", () => {
    const summary = buildAdherenceSummary(fixture);

    expect(summary.dates).toEqual(dates);
    expect(summary.training.rail).toEqual(["complete", "missed", "none", "no_log"]);
    expect(summary.nutrition.rail).toEqual(["complete", "partial", "no_log", "no_log"]);
    // 20th: 1/1 complete · 21st: 0/1 on a logged day → missed ·
    // 22nd: 1/2 → partial · 23rd: 0/2 with no log of any kind → no_log
    expect(summary.habits.rail).toEqual(["complete", "missed", "partial", "no_log"]);
  });

  it("carries the logged days — the derived definition — on the summary", () => {
    const summary = buildAdherenceSummary(fixture);
    // The 23rd has a scheduled event and nothing the client did.
    expect(summary.loggedDates).toEqual(["2026-07-20", "2026-07-21", "2026-07-22"]);
  });

  it("reads a day the client only trained as a logged day, so an unticked habit is Missed", () => {
    // Nothing on the spine: no wellness, no nutrition. A completed workout on
    // the 23rd makes it a logged day, and zero of two eligible habits is a
    // miss rather than silence. Under the spine count it read no_log.
    const summary = buildAdherenceSummary({
      ...fixture,
      nutritionLogs: [],
      habitLogs: [],
      trainingEvents: [{ date: "2026-07-23", status: "completed" }],
    });

    expect(summary.loggedDates).toEqual(["2026-07-23"]);
    expect(summary.habits.rail).toEqual(["no_log", "no_log", "no_log", "missed"]);
  });

  it("does not read a scheduled event, a wellness row with no reading or a coach's work as a log", () => {
    const summary = buildAdherenceSummary({
      ...fixture,
      nutritionLogs: [],
      habitLogs: [],
      trainingEvents: [{ date: "2026-07-23", status: "scheduled" }],
      wellnessLogs: [
        { date: "2026-07-22", mood: null, energy: null, sleep: null, stress: null, soreness: null },
      ],
    });

    expect(summary.loggedDates).toEqual([]);
    expect(summary.habits.rail).toEqual(["no_log", "no_log", "no_log", "no_log"]);
  });

  it("counts a wellness reading and a client-logged measurement as logged days", () => {
    const summary = buildAdherenceSummary({
      ...fixture,
      nutritionLogs: [],
      habitLogs: [],
      trainingEvents: [],
      wellnessLogs: [
        { date: "2026-07-21", mood: 4, energy: null, sleep: null, stress: null, soreness: null },
      ],
      clientLogDates: ["2026-07-23"],
    });

    expect(summary.loggedDates).toEqual(["2026-07-21", "2026-07-23"]);
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
      wellnessLogs: [],
      clientLogDates: [],
    });
    expect(empty.training.pct).toBeNull();
    expect(empty.nutrition.pct).toBeNull();
    expect(empty.habits.avgPct).toBeNull();
    expect(empty.training.rail).toEqual(["none", "none", "none", "none"]);
    expect(empty.loggedDates).toEqual([]);
  });

  describe("the per-habit cut", () => {
    it("scores each habit over its OWN eligible days", () => {
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
  });
});

describe("the nutrition denominator", () => {
  it("is the whole window, not the days the client logged", () => {
    // #5 in one assertion: three logged days all on target is 3/7 and 43%,
    // never 100%. `loggedDays` stays available for anyone who wants it, but it
    // is not what the percentage divides by.
    const summary = buildAdherenceSummary({
      dates: ["d1", "d2", "d3", "d4", "d5", "d6", "d7"],
      trainingEvents: [],
      nutritionLogs: [nut("d1", "hit"), nut("d2", "hit"), nut("d3", "hit")],
      habits: [],
      habitLogs: [],
      wellnessLogs: [],
      clientLogDates: [],
    });

    expect(summary.nutrition.onTarget).toBe(3);
    expect(summary.nutrition.loggedDays).toBe(3);
    expect(summary.nutrition.pct).toBe(43);
  });

  it("is the period's OWN length on a short first week", () => {
    // D5.1: a three-day first period is 3/3, not 3/7. `dates` carries the
    // window, so a partial week cannot be scored against a full one.
    const summary = buildAdherenceSummary({
      dates: ["d1", "d2", "d3"],
      trainingEvents: [],
      nutritionLogs: [nut("d1", "hit"), nut("d2", "hit"), nut("d3", "hit")],
      habits: [],
      habitLogs: [],
      wellnessLogs: [],
      clientLogDates: [],
    });

    expect(summary.nutrition.pct).toBe(100);
  });
});

describe("getClientAdherenceForRange — the reads", () => {
  type Call = [string, ...unknown[]];
  const calls = new Map<string, Call[]>();

  /** One thenable builder per table, recording every filter it is given. */
  function builder(table: string) {
    const record = (method: string) =>
      vi.fn((...args: unknown[]) => {
        calls.get(table)!.push([method, ...args]);
        return q;
      });
    const q: Record<string, unknown> = {
      select: record("select"),
      eq: record("eq"),
      gte: record("gte"),
      lte: record("lte"),
      then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return q;
  }

  beforeEach(() => {
    calls.clear();
    vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
      calls.set(table, calls.get(table) ?? []);
      return builder(table);
    }) as never);
  });

  it("reads the five client sources and never the daily_logs spine", async () => {
    await getClientAdherenceForRange("client-1", "2026-07-20", "2026-07-23");

    expect([...calls.keys()].sort()).toEqual(
      [
        "client_measurements_live",
        "daily_habit_logs",
        "daily_habits",
        "nutrition_logs",
        "training_events",
        "wellness_logs",
      ].sort()
    );
    expect(calls.has("daily_logs")).toBe(false);
  });

  it("counts only the measurements the client logged themselves", async () => {
    // A coach entry, an intake reading or a check-in's stamped row is the
    // coach's work or the weekly report, and neither is a logged day.
    await getClientAdherenceForRange("client-1", "2026-07-20", "2026-07-23");

    expect(calls.get("client_measurements_live")).toContainEqual(["eq", "source", "client_log"]);
    expect(calls.get("client_measurements_live")).toContainEqual(["eq", "client_id", "client-1"]);
  });
});
