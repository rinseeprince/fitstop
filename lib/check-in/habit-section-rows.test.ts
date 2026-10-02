import { describe, it, expect } from "vitest";
import { entryRecordsSomething, habitSectionNotes, habitSectionRows, type HabitRailMark } from "./habit-section-rows";
import { readSentSnapshot, type SentHabitWeek } from "./sent-snapshot";

const EVERY_DAY = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
type Habit = SentHabitWeek["habits"][number];
type Day = Habit["days"][number];

const day = (date: string, facts: Partial<Day> = {}): Day => ({
  date,
  covered: true,
  planned: true,
  target: null,
  entry: null,
  met: false,
  ...facts,
});
const ticked = (note: string | null = null) => ({ done: true, value: null, note });
const number = (value: number, note: string | null = null) => ({ done: null, value, note });

const marks = (habit: ReturnType<typeof habitSectionRows>[number]): HabitRailMark[] => habit.cells.map((cell) => cell.mark);

describe("entryRecordsSomething — whether an entry says anything", () => {
  it("says a tick, a number (a 0 included) or a note records something, and a tick taken back with no note records nothing", () => {
    expect(entryRecordsSomething(ticked())).toBe(true);
    expect(entryRecordsSomething(number(0))).toBe(true);
    expect(entryRecordsSomething({ done: false, value: null, note: "Gym shut" })).toBe(true);
    expect(entryRecordsSomething({ done: false, value: null, note: null })).toBe(false);
    expect(entryRecordsSomething(null)).toBe(false);
  });
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
          day("2026-09-25", { entry: ticked(), met: true }),
          // Not planned, done anyway: a done day is drawn done.
          day("2026-09-26", { planned: false, entry: ticked(), met: true }),
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
    const rows = habitSectionRows(week);
    expect(rows.map((row) => [row.id, row.name, row.figure])).toEqual([
      ["mobility", "Mobility", "2/2"],
      ["walk", "Walk", "0/1"],
    ]);
    expect(marks(rows[0])).toEqual(["not_planned", "done", "done", "missed"]);
    expect(marks(rows[1])).toEqual(["not_yet_added", "not_yet_added", "missed", "not_running"]);
  });

  it("words each habit's days, then its target, as they stood at the week's end", () => {
    const rows = habitSectionRows(week);
    expect(rows[0].words).toBe("Fri, Sun");
    // Stopped after the Saturday: the week's last version still says what it was.
    expect(rows[1].words).toBe("Every day");
  });

  it("words a habit changed during the week by its later version, each day judged against its own target", () => {
    // At least 2 L to the Saturday, at least 3 L from the Sunday.
    const steppedUp: Habit = {
      id: "water",
      name: "Water",
      measure: "number",
      unit: "L",
      direction: "at_least",
      firstStartsOn: "2026-09-01",
      versions: [
        { startsOn: "2026-09-01", endsOn: "2026-09-26", target: 2, timesPerWeek: null, weekdays: [...EVERY_DAY] },
        { startsOn: "2026-09-27", endsOn: null, target: 3, timesPerWeek: null, weekdays: [...EVERY_DAY] },
      ],
      days: [
        day("2026-09-26", { target: 2, entry: number(2.5), met: true }),
        day("2026-09-27", { target: 3, entry: number(2.5) }),
      ],
      figures: { planned: 2, done: 1, met: 1 },
    };
    const [row] = habitSectionRows({ habits: [steppedUp], totals: steppedUp.figures });
    expect(row.words).toBe("Every day · at least 3 L");
    expect(row.cells.map((cell) => [cell.mark, cell.target])).toEqual([
      ["done", "at least 2 L"],
      ["missed", "at least 3 L"],
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
            day("2026-09-26", { entry: ticked(), met: true }),
            day("2026-09-27"),
          ],
          figures: { planned: 2, done: 1, met: 1 },
        },
      ],
      totals: { planned: 2, done: 1, met: 1 },
    };
    expect(marks(habitSectionRows(restarted)[0])).toEqual(["not_running", "not_running", "done", "missed"]);
  });

  it("leaves out a habit the week neither planned nor saw entered: it says nothing about it", () => {
    expect(habitSectionRows(week).map((row) => row.id)).not.toContain("sauna");
  });

  it("lists a habit the week did not plan when the client entered it on a day it ran, with no figure", () => {
    // Sauna, Mondays from the Sunday: planned on no day of the week, done on the Sunday anyway.
    const [, , sauna] = week.habits;
    const doneSunday: Habit = {
      ...sauna,
      days: sauna.days.map((each) => (each.date === "2026-09-27" ? { ...each, entry: ticked("Hotel gym"), met: true } : each)),
      figures: { planned: 0, done: 1, met: 0 },
    };
    const withSauna = { ...week, habits: [week.habits[0], week.habits[1], doneSunday] };

    const row = habitSectionRows(withSauna).find((each) => each.id === "sauna")!;
    expect(row.figure).toBeNull();
    expect(marks(row)).toEqual(["not_yet_added", "not_yet_added", "not_yet_added", "done"]);
    expect(habitSectionNotes(withSauna)).toEqual([{ date: "2026-09-27", habitId: "sauna", habit: "Sauna", note: "Hotel gym" }]);
  });

  it("leaves out a habit whose only entry is a tick taken back with no note: it records nothing", () => {
    const [, , sauna] = week.habits;
    const untickedSunday: Habit = {
      ...sauna,
      days: sauna.days.map((each) => (each.date === "2026-09-27" ? { ...each, entry: { done: false, value: null, note: null } } : each)),
    };
    const withSauna = { ...week, habits: [week.habits[0], week.habits[1], untickedSunday] };
    expect(habitSectionRows(withSauna).map((row) => row.id)).not.toContain("sauna");

    // The same untick with a note says something the coach should read.
    const notedSunday: Habit = {
      ...sauna,
      days: sauna.days.map((each) => (each.date === "2026-09-27" ? { ...each, entry: { done: false, value: null, note: "Gym shut" } } : each)),
    };
    const withNote = { ...week, habits: [week.habits[0], week.habits[1], notedSunday] };
    expect(habitSectionRows(withNote).map((row) => row.id)).toContain("sauna");
    expect(habitSectionNotes(withNote)).toEqual([{ date: "2026-09-27", habitId: "sauna", habit: "Sauna", note: "Gym shut" }]);
  });

  it("leaves out a habit whose only entry sits on a day no version covered", () => {
    const [, , sauna] = week.habits;
    // An entry kept from before the habit was added: in no figure, and no reason to list it.
    const keptSaturday: Habit = {
      ...sauna,
      days: sauna.days.map((each) => (each.date === "2026-09-26" ? { ...each, entry: ticked("Old") } : each)),
    };
    const withSauna = { ...week, habits: [week.habits[0], week.habits[1], keptSaturday] };

    expect(habitSectionRows(withSauna).map((row) => row.id)).not.toContain("sauna");
    expect(habitSectionNotes(withSauna)).toEqual([]);
  });

  it("has no rows without a week", () => {
    expect(habitSectionRows(null)).toEqual([]);
  });

  // The plan's week (docs/HABITS-REBUILD-PLAN.md §2.5): Water at least 3 L
  // every day, short on the Saturday and the Monday, a note on the Saturday.
  const DATES = ["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"];
  const VALUES = [3.1, 3.0, 2.1, 3.2, 2.5, 3.0, 3.0];
  const water: Habit = {
    id: "water",
    name: "Water",
    measure: "number",
    unit: "L",
    direction: "at_least",
    firstStartsOn: "2026-09-01",
    versions: [{ startsOn: "2026-09-01", endsOn: null, target: 3, timesPerWeek: null, weekdays: [...EVERY_DAY] }],
    days: DATES.map((date, i) =>
      day(date, {
        target: 3,
        entry: number(VALUES[i], date === "2026-09-26" ? "Travelling, only had the one bottle" : null),
        met: VALUES[i] >= 3,
      })
    ),
    figures: { planned: 7, done: 5, met: 5 },
  };
  const sauna: Habit = {
    id: "sauna",
    name: "Sauna",
    measure: "tick",
    unit: null,
    direction: null,
    firstStartsOn: "2026-09-01",
    versions: [{ startsOn: "2026-09-01", endsOn: null, target: null, timesPerWeek: 3, weekdays: [] }],
    days: DATES.map((date) =>
      ["2026-09-25", "2026-09-27", "2026-09-30"].includes(date)
        ? day(date, { planned: false, entry: ticked(date === "2026-09-30" ? "Late one" : null), met: true })
        : day(date, { planned: false })
    ),
    figures: { planned: 3, done: 3, met: 3 },
  };
  const planWeek: SentHabitWeek = { habits: [water, sauna], totals: { planned: 10, done: 8, met: 8 } };

  it("puts a number habit's number in each day, judged against that day's target, with the target in words", () => {
    const [row] = habitSectionRows(planWeek);
    expect(row.cells.map((cell) => [cell.value, cell.mark])).toEqual([
      [3.1, "done"],
      [3.0, "done"],
      [2.1, "missed"],
      [3.2, "done"],
      [2.5, "missed"],
      [3.0, "done"],
      [3.0, "done"],
    ]);
    expect(row.cells[2].target).toBe("at least 3 L");
    expect(row.words).toBe("Every day · at least 3 L");
    expect(row.figure).toBe("5/7");
  });

  it("gives a number habit its week's average, to one decimal in its unit, and a tick habit none", () => {
    const [water, sauna] = habitSectionRows(planWeek);
    // 19.9 L over seven days: 2.84, written 2.8.
    expect(water.average).toBe("avg 2.8 L");
    expect(sauna.average).toBeNull();
    expect(sauna.words).toBe("3 times a week");
    expect(sauna.cells.map((cell) => cell.value)).toEqual([null, null, null, null, null, null, null]);
  });

  it("marks the days a habit done N times a week was not done as any day of the week, never not planned", () => {
    const [, sauna] = habitSectionRows(planWeek);
    expect(marks(sauna)).toEqual(["any_day", "done", "any_day", "done", "any_day", "any_day", "done"]);
  });

  it("shows no number on a day no version covered: an entry kept from a stop is in no figure", () => {
    const stopped: Habit = {
      ...water,
      days: water.days.map((each) => (each.date === "2026-09-30" ? { ...each, covered: false, planned: false, met: false } : each)),
    };
    const [row] = habitSectionRows({ habits: [stopped], totals: stopped.figures });
    expect(row.cells[6]).toEqual({ date: "2026-09-30", mark: "not_running", value: null, target: null });
  });

  it("lists the client's notes under the table, oldest day first, in the habits' order within a day", () => {
    expect(habitSectionNotes(planWeek)).toEqual([
      { date: "2026-09-26", habitId: "water", habit: "Water", note: "Travelling, only had the one bottle" },
      { date: "2026-09-30", habitId: "sauna", habit: "Sauna", note: "Late one" },
    ]);
  });

  it("leaves out a note on a day no version covered, a habit stopped before the week with its kept note among them", () => {
    const stoppedSaturday: Habit = {
      ...water,
      days: water.days.map((each) => (each.date === "2026-09-26" ? { ...each, covered: false, planned: false, met: false } : each)),
    };
    // Nap: stopped before the week, its entries and the Wednesday's note kept from before the stop.
    const stopped: Habit = {
      ...sauna,
      id: "nap",
      name: "Nap",
      days: sauna.days.map((each) => ({ ...each, covered: false, planned: false, met: false })),
      figures: { planned: 0, done: 0, met: 0 },
    };
    expect(habitSectionNotes({ habits: [stoppedSaturday, stopped], totals: stoppedSaturday.figures })).toEqual([]);
    expect(habitSectionRows({ habits: [stoppedSaturday, stopped], totals: stoppedSaturday.figures }).map((row) => row.id)).toEqual(["water"]);
    expect(habitSectionNotes(null)).toEqual([]);
  });

  // The frozen week must not move (docs/HABITS-REBUILD-PLAN.md §5): a copy
  // saved as version 2 draws the figures and marks the section drew from its
  // `perHabit` — each habit ever eligible, completed over eligible days, and
  // its rail's ticks, misses and "not yet added" dashes — as tick habits planned
  // every day they existed.
  it("draws a version 2 copy's figures and marks as the section drew them before", () => {
    const perHabit = [
      { id: "h1", name: "Water", eligibleDays: 7, completedDays: 5, pct: 71, rail: [true, true, false, true, true, false, true] },
      { id: "h2", name: "Steps", eligibleDays: 4, completedDays: 2, pct: 50, rail: [null, null, null, true, false, true, false] },
      { id: "h3", name: "Later", eligibleDays: 0, completedDays: 0, pct: null, rail: [null, null, null, null, null, null, null] },
    ];
    const copy = readSentSnapshot({
      version: 2,
      day: "2026-09-30",
      readings: { weight: null, bodyFat: null, waist: null, hips: null, chest: null, arms: null, thighs: null },
      standing: { weight: null, bodyFat: null },
      goal: null,
      goalProgress: {},
      nutritionPlan: null,
      period: {
        dates: DATES,
        loggedDates: [],
        nutrition: [],
        habits: { rail: [], avgPct: null, daysBelow50: 0, perHabit },
      },
      questions: [],
    });

    const rows = habitSectionRows(copy!.period!.habitWeek);
    const before = perHabit
      .filter((habit) => habit.eligibleDays > 0)
      .map((habit) => ({
        id: habit.id,
        name: habit.name,
        figure: `${habit.completedDays}/${habit.eligibleDays}`,
        marks: habit.rail.map((ticked) => (ticked === null ? "not_yet_added" : ticked ? "done" : "missed")),
      }));
    expect(rows.map((row) => ({ id: row.id, name: row.name, figure: row.figure, marks: marks(row) }))).toEqual(before);
    // A version 2 copy saved ticks and no targets: every day it existed, a tick habit.
    expect(rows.map((row) => [row.words, row.average])).toEqual([
      ["Every day", null],
      ["Every day", null],
    ]);
    expect(habitSectionNotes(copy!.period!.habitWeek)).toEqual([]);
  });
});
