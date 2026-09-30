import { describe, it, expect } from "vitest";
import { habitSectionRows } from "./habit-section-rows";
import { readSentSnapshot, type SentHabitWeek } from "./sent-snapshot";

const EVERY_DAY = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
type Day = SentHabitWeek["habits"][number]["days"][number];

const day = (date: string, facts: Partial<Day> = {}): Day => ({
  date,
  covered: true,
  planned: true,
  target: null,
  entry: null,
  met: false,
  ...facts,
});

describe("habitSectionRows — the review's Habits section, row by row", () => {
  // Thu 24 to Sun 27 September 2026.
  const week: SentHabitWeek = {
    habits: [
      {
        id: "mobility",
        name: "Mobility",
        measure: "tick",
        unit: null,
        direction: null,
        firstStartsOn: "2026-09-01",
        versions: [{ startsOn: "2026-09-01", endsOn: null, target: null, timesPerWeek: null, weekdays: ["friday", "sunday"] }],
        days: [
          day("2026-09-24", { planned: false }),
          day("2026-09-25", { entry: { done: true, value: null, note: null }, met: true }),
          // Not planned, done anyway: a done day is drawn done.
          day("2026-09-26", { planned: false, entry: { done: true, value: null, note: null }, met: true }),
          day("2026-09-27"),
        ],
        figures: { planned: 2, done: 2, met: 2 },
      },
      {
        id: "walk",
        name: "Walk",
        measure: "tick",
        unit: null,
        direction: null,
        // Added on the Saturday, stopped after the Saturday.
        firstStartsOn: "2026-09-26",
        versions: [{ startsOn: "2026-09-26", endsOn: "2026-09-26", target: null, timesPerWeek: null, weekdays: [...EVERY_DAY] }],
        days: [
          day("2026-09-24", { covered: false, planned: false }),
          day("2026-09-25", { covered: false, planned: false }),
          day("2026-09-26"),
          day("2026-09-27", { covered: false, planned: false }),
        ],
        figures: { planned: 1, done: 0, met: 0 },
      },
      {
        id: "sauna",
        name: "Sauna",
        measure: "tick",
        unit: null,
        direction: null,
        firstStartsOn: "2026-09-27",
        versions: [{ startsOn: "2026-09-27", endsOn: null, target: null, timesPerWeek: null, weekdays: ["monday"] }],
        days: [
          day("2026-09-24", { covered: false, planned: false }),
          day("2026-09-25", { covered: false, planned: false }),
          day("2026-09-26", { covered: false, planned: false }),
          day("2026-09-27", { planned: false }),
        ],
        figures: { planned: 0, done: 0, met: 0 },
      },
    ],
    totals: { planned: 3, done: 2, met: 2 },
  };

  it("draws each planned habit's figure and each day as it happened", () => {
    expect(habitSectionRows(week)).toEqual([
      { id: "mobility", name: "Mobility", figure: "2/2", rail: ["not_planned", "done", "done", "missed"] },
      { id: "walk", name: "Walk", figure: "0/1", rail: ["not_yet_added", "not_yet_added", "missed", "not_running"] },
    ]);
  });

  it("draws a habit stopped before the week and started again inside it as not running before the restart, never not yet added", () => {
    // Added in August and stopped; started again on the Saturday. The week
    // holds only the restart, but the habit was added long before it.
    const restarted: SentHabitWeek = {
      habits: [
        {
          id: "stretch",
          name: "Stretch",
          measure: "tick",
          unit: null,
          direction: null,
          firstStartsOn: "2026-08-03",
          versions: [{ startsOn: "2026-09-26", endsOn: null, target: null, timesPerWeek: null, weekdays: [...EVERY_DAY] }],
          days: [
            day("2026-09-24", { covered: false, planned: false }),
            day("2026-09-25", { covered: false, planned: false }),
            day("2026-09-26", { entry: { done: true, value: null, note: null }, met: true }),
            day("2026-09-27"),
          ],
          figures: { planned: 2, done: 1, met: 1 },
        },
      ],
      totals: { planned: 2, done: 1, met: 1 },
    };
    expect(habitSectionRows(restarted)[0].rail).toEqual(["not_running", "not_running", "done", "missed"]);
  });

  it("leaves out a habit with nothing planned that week: it says nothing about it", () => {
    expect(habitSectionRows(week).map((row) => row.id)).not.toContain("sauna");
  });

  it("has no rows without a week", () => {
    expect(habitSectionRows(null)).toEqual([]);
  });

  // The frozen week must not move (docs/HABITS-REBUILD-PLAN.md §5): a copy
  // saved as version 2 draws exactly what the section drew from its
  // `perHabit` — each habit ever eligible, completed over eligible days, and
  // its rail's ticks, misses and "not yet added" dashes.
  it("draws a version 2 copy exactly as the section drew it before", () => {
    const perHabit = [
      { id: "h1", name: "Water", eligibleDays: 7, completedDays: 5, pct: 71, rail: [true, true, false, true, true, false, true] },
      { id: "h2", name: "Steps", eligibleDays: 4, completedDays: 2, pct: 50, rail: [null, null, null, true, false, true, false] },
      { id: "h3", name: "Later", eligibleDays: 0, completedDays: 0, pct: null, rail: [null, null, null, null, null, null, null] },
    ];
    const dates = ["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"];
    const copy = readSentSnapshot({
      version: 2,
      day: "2026-09-30",
      readings: { weight: null, bodyFat: null, waist: null, hips: null, chest: null, arms: null, thighs: null },
      standing: { weight: null, bodyFat: null },
      goal: null,
      goalProgress: {},
      nutritionPlan: null,
      period: {
        dates,
        loggedDates: [],
        nutrition: [],
        habits: { rail: [], avgPct: null, daysBelow50: 0, perHabit },
      },
      questions: [],
    });

    const before = perHabit
      .filter((habit) => habit.eligibleDays > 0)
      .map((habit) => ({
        id: habit.id,
        name: habit.name,
        figure: `${habit.completedDays}/${habit.eligibleDays}`,
        rail: habit.rail.map((ticked) => (ticked === null ? "not_yet_added" : ticked ? "done" : "missed")),
      }));
    expect(habitSectionRows(copy!.period!.habitWeek)).toEqual(before);
  });
});
