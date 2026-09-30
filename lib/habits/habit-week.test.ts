import { describe, it, expect } from "vitest";
import { habitDays, habitDayTallies, habitWeek, missedPlannedDates, sumWeekFigures } from "./habit-week";
import type { ClientHabit, HabitEntry, HabitVersion } from "@/types/habits";

// The plan's week (docs/HABITS-REBUILD-PLAN.md §2.5): a client whose week runs
// Thursday 24 to Wednesday 30 September 2026, seen on the Wednesday morning.
const WEEK = [
  "2026-09-24", // Thu
  "2026-09-25", // Fri
  "2026-09-26", // Sat
  "2026-09-27", // Sun
  "2026-09-28", // Mon
  "2026-09-29", // Tue
  "2026-09-30", // Wed
];
const EVERY_DAY: HabitVersion["weekdays"] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

function version(overrides: Partial<HabitVersion> = {}): HabitVersion {
  return { id: "v", startsOn: "2026-09-01", endsOn: null, target: null, timesPerWeek: null, weekdays: EVERY_DAY, ...overrides };
}

const water: ClientHabit = {
  id: "water",
  name: "Water",
  howTo: null,
  measure: "number",
  unit: "L",
  direction: "at_least",
  position: 1,
  versions: [version({ id: "water-v", target: 3 })],
  dayEdits: [],
};
const mobility: ClientHabit = {
  id: "mobility",
  name: "Mobility",
  howTo: null,
  measure: "tick",
  unit: null,
  direction: null,
  position: 2,
  versions: [version({ id: "mobility-v", weekdays: ["monday", "wednesday", "friday"] })],
  dayEdits: [],
};
const sauna: ClientHabit = {
  id: "sauna",
  name: "Sauna",
  howTo: null,
  measure: "tick",
  unit: null,
  direction: null,
  position: 3,
  versions: [version({ id: "sauna-v", timesPerWeek: 3, weekdays: [] })],
  dayEdits: [],
};

const number = (habitId: string, date: string, value: number): HabitEntry => ({ habitId, date, done: null, value, note: null });
const ticked = (habitId: string, date: string, done = true): HabitEntry => ({ habitId, date, done, value: null, note: null });

const WEDNESDAY_MORNING: HabitEntry[] = [
  number("water", "2026-09-24", 3.1),
  number("water", "2026-09-25", 3.0),
  number("water", "2026-09-26", 2.1),
  number("water", "2026-09-27", 3.2),
  number("water", "2026-09-28", 2.5),
  number("water", "2026-09-29", 3.0),
  ticked("mobility", "2026-09-25"),
  ticked("mobility", "2026-09-28", false),
  ticked("mobility", "2026-09-29"),
  ticked("sauna", "2026-09-25"),
  ticked("sauna", "2026-09-27"),
];
const WEDNESDAY_EVENING: HabitEntry[] = [
  ...WEDNESDAY_MORNING,
  number("water", "2026-09-30", 3.0),
  ticked("mobility", "2026-09-30"),
  ticked("sauna", "2026-09-30"),
];

describe("habitWeek — the plan's week", () => {
  it("reads 4/7, 2/3 and 2/3 on the Wednesday morning: 8 of 13", () => {
    const weeks = [water, mobility, sauna].map((habit) => habitWeek(habit, WEDNESDAY_MORNING, WEEK).figures);
    expect(weeks).toEqual([
      { planned: 7, done: 4, met: 4 },
      { planned: 3, done: 2, met: 2 },
      { planned: 3, done: 2, met: 2 },
    ]);
    expect(sumWeekFigures(weeks)).toEqual({ planned: 13, done: 8, met: 8 });
  });

  it("adds each habit's own met to the totals, so a habit done past its plan lends nothing to another", () => {
    const everyDayMobility = WEEK.map((date) => ticked("mobility", date));
    const weeks = [water, mobility].map((habit) => habitWeek(habit, [...WEDNESDAY_MORNING, ...everyDayMobility], WEEK).figures);
    expect(weeks).toEqual([
      { planned: 7, done: 4, met: 4 },
      { planned: 3, done: 7, met: 3 },
    ]);
    expect(sumWeekFigures(weeks)).toEqual({ planned: 10, done: 11, met: 7 });
  });

  it("reads 11 of 13 once the client has done Wednesday's", () => {
    const weeks = [water, mobility, sauna].map((habit) => habitWeek(habit, WEDNESDAY_EVENING, WEEK).figures);
    expect(sumWeekFigures(weeks)).toEqual({ planned: 13, done: 11, met: 11 });
  });

  it("shows each day as it happened: Monday planned and not done, Tuesday not planned and done", () => {
    const days = habitWeek(mobility, WEDNESDAY_MORNING, WEEK).days;
    expect(days.find((day) => day.date === "2026-09-28")).toMatchObject({ planned: true, met: false, entry: { done: false } });
    expect(days.find((day) => day.date === "2026-09-29")).toMatchObject({ planned: false, met: true, entry: { done: true } });
    expect(days.find((day) => day.date === "2026-09-30")).toMatchObject({ planned: true, met: false, entry: null });
  });
});

describe("habitWeek — the rules", () => {
  it("counts a day made up toward its week up to the planned number, and no further", () => {
    const everyDay = WEEK.map((date) => ticked("mobility", date));
    expect(habitWeek(mobility, everyDay, WEEK).figures).toEqual({ planned: 3, done: 7, met: 3 });
  });

  it("never asks a weekly habit for more times than the days it runs that week (D2)", () => {
    const fromTuesday = { ...sauna, versions: [version({ timesPerWeek: 3, weekdays: [], startsOn: "2026-09-29" })] };
    expect(habitWeek(fromTuesday, [], WEEK).figures.planned).toBe(2);
    const fromWednesday = { ...sauna, versions: [version({ timesPerWeek: 3, weekdays: [], startsOn: "2026-09-30" })] };
    expect(habitWeek(fromWednesday, [], WEEK).figures.planned).toBe(1);
  });

  it("asks a weekly habit paused, restarted or changed mid-week for its largest frequency that week, not two added", () => {
    const weekly = (...versions: Array<[string, string | null, number]>) => ({
      ...sauna,
      versions: versions.map(([startsOn, endsOn, times], i) =>
        version({ id: `sauna-${i}`, startsOn, endsOn, timesPerWeek: times, weekdays: [] })
      ),
    });
    // Stopped after Friday, started again on Monday: 2 days then 3, each capped, still 3 a week.
    expect(habitWeek(weekly(["2026-09-01", "2026-09-25", 3], ["2026-09-28", null, 3]), [], WEEK).figures.planned).toBe(3);
    // 3 a week to Sunday, then 4 a week: the week asks 4.
    expect(habitWeek(weekly(["2026-09-01", "2026-09-27", 3], ["2026-09-28", null, 4]), [], WEEK).figures.planned).toBe(4);
    // 3 a week to Sunday, then 2 a week: the week asks 3.
    expect(habitWeek(weekly(["2026-09-01", "2026-09-27", 3], ["2026-09-28", null, 2]), [], WEEK).figures.planned).toBe(3);
    // A version that ended before the week raises nothing.
    expect(
      habitWeek(weekly(["2026-08-01", "2026-08-31", 7], ["2026-09-01", "2026-09-25", 3], ["2026-09-28", null, 2]), [], WEEK)
        .figures.planned
    ).toBe(3);
  });

  it("caps a weekly habit at the days of a check-in period clamped to the start day", () => {
    expect(habitWeek(sauna, [], WEEK.slice(5)).figures.planned).toBe(2);
  });

  it("follows a one-date edit: a planned day taken off is not asked for", () => {
    const wednesdayOff = { ...mobility, dayEdits: [{ date: "2026-09-30", planned: false, target: null }] };
    expect(habitWeek(wednesdayOff, WEDNESDAY_MORNING, WEEK).figures).toEqual({ planned: 2, done: 2, met: 2 });
  });

  it("judges a number on a one-date target in its direction", () => {
    const lighterSaturday = { ...water, dayEdits: [{ date: "2026-09-26", planned: true, target: 2 }] };
    expect(habitWeek(lighterSaturday, WEDNESDAY_MORNING, WEEK).figures.done).toBe(5);

    const drinks: ClientHabit = {
      ...water,
      id: "drinks",
      unit: "drinks",
      direction: "at_most",
      versions: [version({ target: 2 })],
    };
    const entries = [number("drinks", "2026-09-24", 3), number("drinks", "2026-09-25", 2), number("drinks", "2026-09-26", 0)];
    expect(habitWeek(drinks, entries, WEEK).figures.done).toBe(2);
  });

  it("counts an entry on a day no version covers in no figure", () => {
    // Stopped from Monday: Tuesday's 3 L would meet the target, but no version covers Tuesday.
    const stoppedMonday = { ...water, versions: [version({ target: 3, endsOn: "2026-09-27" })] };
    const week = habitWeek(stoppedMonday, WEDNESDAY_MORNING, WEEK);
    expect(week.figures).toEqual({ planned: 4, done: 3, met: 3 });
    expect(week.days[5]).toMatchObject({ covered: false, met: false, entry: { value: 3 } });

    // A tick habit too: Mobility stopped from Monday, then ticked on the Tuesday.
    const mobilityStopped = { ...mobility, versions: [version({ weekdays: ["monday", "wednesday", "friday"], endsOn: "2026-09-27" })] };
    expect(habitWeek(mobilityStopped, WEDNESDAY_MORNING, WEEK).figures).toEqual({ planned: 1, done: 1, met: 1 });
  });

  it("reads each day against its own version when the target changes mid-week", () => {
    const steppedUp = {
      ...water,
      versions: [version({ target: 3, endsOn: "2026-09-27" }), version({ id: "v2", target: 3.2, startsOn: "2026-09-28" })],
    };
    const days = habitWeek(steppedUp, [number("water", "2026-09-27", 3.1), number("water", "2026-09-28", 3.1)], WEEK).days;
    expect(days[3]).toMatchObject({ target: 3, met: true });
    expect(days[4]).toMatchObject({ target: 3.2, met: false });
  });

  it("only counts the habit's own entries", () => {
    expect(habitWeek(mobility, [ticked("someone-else", "2026-09-25")], WEEK).figures.done).toBe(0);
  });
});

describe("a range read day by day", () => {
  it("judges each day by its own planned habits, with no credit from another day (D8)", () => {
    const tallies = habitDayTallies([water, mobility, sauna], WEDNESDAY_MORNING, WEEK);
    expect(tallies.find((tally) => tally.date === "2026-09-28")).toEqual({ date: "2026-09-28", planned: 2, done: 0 });
    expect(tallies.find((tally) => tally.date === "2026-09-29")).toEqual({ date: "2026-09-29", planned: 1, done: 1 });
    expect(tallies.find((tally) => tally.date === "2026-09-30")).toEqual({ date: "2026-09-30", planned: 2, done: 0 });
  });

  it("lists a habit's planned days gone without it done on the day, a short number included (D4)", () => {
    // Mobility's Monday was made up on the Tuesday: the week counts it, the day stays missed.
    expect(missedPlannedDates(mobility, WEDNESDAY_MORNING, WEEK)).toEqual(["2026-09-28", "2026-09-30"]);
    // Saturday's 2.1 L and Monday's 2.5 L fell short of 3 L; Wednesday has no entry yet.
    expect(missedPlannedDates(water, WEDNESDAY_MORNING, WEEK)).toEqual(["2026-09-26", "2026-09-28", "2026-09-30"]);
    // A weekly habit plans no day, so it misses none.
    expect(missedPlannedDates(sauna, [], WEEK)).toEqual([]);
  });

  it("misses no day a one-date edit took off, and misses a day it put on", () => {
    const edited = {
      ...mobility,
      dayEdits: [
        { date: "2026-09-28", planned: false, target: null },
        { date: "2026-09-26", planned: true, target: null },
      ],
    };
    expect(missedPlannedDates(edited, WEDNESDAY_MORNING, WEEK)).toEqual(["2026-09-26", "2026-09-30"]);
  });

  it("lists days as they happened for any dates", () => {
    const days = habitDays(water, WEDNESDAY_MORNING, ["2026-09-26", "2026-09-27"]);
    expect(days.map((day) => [day.date, day.entry?.value, day.met])).toEqual([
      ["2026-09-26", 2.1, false],
      ["2026-09-27", 3.2, true],
    ]);
  });
});
