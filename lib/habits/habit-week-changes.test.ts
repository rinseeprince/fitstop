import { describe, it, expect } from "vitest";
import { answerLandsAlone, sameDayPlan, weekWithDay, weekWithEntry, weekWithRow } from "./habit-week-changes";
import { habitWeek } from "./habit-week";
import type { ClientHabit, ClientHabitWeek, HabitDayFacts, HabitEntry, HabitVersion, HabitWeekRow } from "@/types/habits";

// The plan's week (docs/HABITS-REBUILD-PLAN.md §2.5): Thursday 24 to
// Wednesday 30 September 2026, on the Wednesday morning.
const WEEK = ["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"];
const EVERY_DAY: HabitVersion["weekdays"] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

const version = (overrides: Partial<HabitVersion> = {}): HabitVersion => ({
  id: "v", startsOn: "2026-09-01", endsOn: null, target: null, timesPerWeek: null, weekdays: EVERY_DAY, ...overrides,
});
const water: ClientHabit = {
  id: "water", name: "Water", howTo: null, measure: "number", unit: "L", direction: "at_least", position: 1,
  versions: [version({ target: 3 })], dayEdits: [],
};
const mobility: ClientHabit = {
  id: "mobility", name: "Mobility", howTo: null, measure: "tick", unit: null, direction: null, position: 2,
  versions: [version({ weekdays: ["monday", "wednesday", "friday"] })], dayEdits: [],
};
const number = (habitId: string, date: string, value: number): HabitEntry => ({ habitId, date, done: null, value, note: null });
const ticked = (habitId: string, date: string, done = true): HabitEntry => ({ habitId, date, done, value: null, note: null });

const MORNING: HabitEntry[] = [
  number("water", "2026-09-24", 3.1),
  number("water", "2026-09-26", 2.1),
  ticked("mobility", "2026-09-25"),
  ticked("mobility", "2026-09-28", false),
];

/** The week as the server reads it: the kernel over the habits and entries, as the habit week route does. */
function read(entries: HabitEntry[], dates: string[] = WEEK, habits: ClientHabit[] = [water, mobility]): ClientHabitWeek {
  const rows: HabitWeekRow[] = habits.map((habit) => {
    const week = habitWeek(habit, entries, dates);
    return {
      habit: { id: habit.id, name: habit.name, howTo: null, measure: habit.measure, unit: habit.unit, direction: habit.direction },
      words: { schedule: null, target: null },
      days: week.days,
      figures: week.figures,
    };
  });
  const totals = rows.reduce(
    (sum, row) => ({ planned: sum.planned + row.figures.planned, done: sum.done + row.figures.done, met: sum.met + row.figures.met }),
    { planned: 0, done: 0, met: 0 }
  );
  return { start: dates[0], end: dates[dates.length - 1], dates, habits: rows, totals };
}

const dayOf = (week: ClientHabitWeek, habitId: string, date: string) =>
  week.habits.find((row) => row.habit.id === habitId)!.days.find((day) => day.date === date)!;

describe("weekWithDay — the entry route's answer, landed on the step's week", () => {
  it("moves the habit's figures and the totals exactly as reading the week again would", () => {
    // Every habit, every day, entered or cleared: the moved week is the read week.
    for (const habitId of ["water", "mobility"]) {
      for (const date of WEEK) {
        const before = read(MORNING);
        const others = MORNING.filter((entry) => !(entry.habitId === habitId && entry.date === date));
        const entered = habitId === "water" ? number(habitId, date, 3.5) : ticked(habitId, date);
        for (const entries of [[...others, entered], others]) {
          const after = read(entries);
          expect(weekWithDay(before, habitId, dayOf(after, habitId, date))).toEqual(after);
        }
      }
    }
  });

  it("moves a check-in period clamped to the start day over its own dates, not the whole client week", () => {
    // Three days of the week: Water planned 3, not 7.
    const clamped = WEEK.slice(4);
    const before = read([], clamped);
    const after = read([number("water", "2026-09-29", 3.2)], clamped);
    const moved = weekWithDay(before, "water", dayOf(after, "water", "2026-09-29"));
    expect(moved.habits[0].figures).toEqual({ planned: 3, done: 1, met: 1 });
    expect(moved).toEqual(after);
  });

  it("caps met at planned when a day is made up past the plan", () => {
    // Mobility done on all three planned days, then on the Tuesday too: 4 done, 3 met.
    const full = [ticked("mobility", "2026-09-25"), ticked("mobility", "2026-09-28"), ticked("mobility", "2026-09-30")];
    const before = read(full);
    const after = read([...full, ticked("mobility", "2026-09-29")]);
    const moved = weekWithDay(before, "mobility", dayOf(after, "mobility", "2026-09-29"));
    expect(moved.habits[1].figures).toEqual({ planned: 3, done: 4, met: 3 });
  });

  it("leaves the week as it is for a habit or a day it does not hold", () => {
    const before = read(MORNING);
    expect(weekWithDay(before, "sauna", dayOf(before, "water", "2026-09-24"))).toBe(before);
    expect(weekWithDay(before, "water", { ...dayOf(before, "water", "2026-09-24"), date: "2026-10-01" })).toBe(before);
  });
});

describe("weekWithEntry — the client's change, shown before its answer", () => {
  it("judges the entry against the day's target in the habit's direction, and moves the figures by that day", () => {
    const before = read(MORNING);
    const short = weekWithEntry(before, "water", "2026-09-27", { done: null, value: 2.9, note: null });
    expect(dayOf(short, "water", "2026-09-27")).toMatchObject({ entry: { value: 2.9 }, met: false });
    expect(short).toEqual(read([...MORNING, number("water", "2026-09-27", 2.9)]));
    const met = weekWithEntry(before, "water", "2026-09-27", { done: null, value: 3, note: null });
    expect(met).toEqual(read([...MORNING, number("water", "2026-09-27", 3)]));
  });

  it("clears an entry: the day held a met tick and holds none", () => {
    const before = read(MORNING);
    const cleared = weekWithEntry(before, "mobility", "2026-09-25", null);
    expect(cleared).toEqual(read(MORNING.filter((entry) => !(entry.habitId === "mobility" && entry.date === "2026-09-25"))));
  });

  it("takes no entry on a day no version covers", () => {
    const stopped: ClientHabit = { ...water, versions: [version({ target: 3, endsOn: "2026-09-27" })] };
    const rows = [stopped].map((habit) => {
      const week = habitWeek(habit, [], WEEK);
      return {
        habit: { id: "water", name: "Water", howTo: null, measure: "number" as const, unit: "L", direction: "at_least" as const },
        words: { schedule: null, target: null },
        days: week.days,
        figures: week.figures,
      };
    });
    const before: ClientHabitWeek = { start: WEEK[0], end: WEEK[6], dates: WEEK, habits: rows, totals: rows[0].figures };
    expect(weekWithEntry(before, "water", "2026-09-29", { done: null, value: 3, note: null })).toBe(before);
  });
});

describe("weekWithRow — one habit as another read has it", () => {
  it("replaces the habit's row and adds the totals up again", () => {
    const before = read(MORNING);
    const fresh = read([...MORNING, number("water", "2026-09-27", 3.4)]);
    const landed = weekWithRow(before, "water", fresh.habits[0]);
    expect(landed.habits[0]).toBe(fresh.habits[0]);
    expect(landed.habits[1]).toBe(before.habits[1]);
    expect(landed.totals).toEqual(fresh.totals);
  });

  it("leaves the habit out when the read no longer lists it, and adds none the week does not hold", () => {
    const before = read(MORNING);
    const without = weekWithRow(before, "water", null);
    expect(without.habits.map((row) => row.habit.id)).toEqual(["mobility"]);
    expect(without.totals).toEqual(before.habits[1].figures);
    expect(weekWithRow(before, "sauna", before.habits[0])).toBe(before);
  });
});

describe("answerLandsAlone — whether the entry route's answer can land by its day alone", () => {
  /** The entry route's answer after `entries`: the habit's day and the whole client week holding it. */
  function answerAfter(entries: HabitEntry[], habit: ClientHabit, date: string, habitVersions = habit.versions) {
    const week = habitWeek({ ...habit, versions: habitVersions }, entries, WEEK);
    return { day: week.days[WEEK.indexOf(date)], week: { ...week.figures, start: WEEK[0], end: WEEK[6] } };
  }
  const MONDAY = "2026-09-28";
  /** The morning's entries with the Monday's Mobility ticked: what the server holds once the tick saves. */
  const mondayTicked = [...MORNING.filter((entry) => !(entry.habitId === "mobility" && entry.date === MONDAY)), ticked("mobility", MONDAY)];

  it("lands an answer whose day is planned as the week holds it and whose week counts what the moved row counts", () => {
    expect(answerLandsAlone(read(MORNING), "mobility", answerAfter(mondayTicked, mobility, MONDAY))).toBe(true);
  });

  it("reads again when the coach changed another day underneath: the answer's week plans one day fewer", () => {
    // From the Tuesday, Mondays and Fridays: the Wednesday is no longer planned.
    const changed = [
      version({ weekdays: ["monday", "wednesday", "friday"], endsOn: MONDAY }),
      version({ startsOn: "2026-09-29", weekdays: ["monday", "friday"] }),
    ];
    expect(answerLandsAlone(read(MORNING), "mobility", answerAfter(mondayTicked, mobility, MONDAY, changed))).toBe(false);
  });

  it("reads again when the answered day itself is planned otherwise", () => {
    const answer = answerAfter(mondayTicked, mobility, MONDAY);
    expect(answerLandsAlone(read(MORNING), "mobility", { ...answer, day: { ...answer.day, planned: false } })).toBe(false);
  });

  it("reads again on a first week clamped to the start day, which the answer's whole week cannot vouch for", () => {
    const clamped = read(MORNING, WEEK.slice(4));
    expect(answerLandsAlone(clamped, "mobility", answerAfter(mondayTicked, mobility, MONDAY))).toBe(false);
  });

  it("reads again on a clamped first week even when the whole week counts the same: the coach moved a planned day out of the step's days", () => {
    // The step holds Monday to Wednesday, Mobility on Mondays and Wednesdays.
    const monWed: ClientHabit = { ...mobility, versions: [version({ weekdays: ["monday", "wednesday"] })] };
    const clamped = read([], WEEK.slice(4), [water, monWed]);
    // The coach moved the Wednesday to Thursdays: the whole week plans the
    // Thursday before the step's days, and the Monday — two days, as the
    // step's Monday and its now stale Wednesday count.
    const answer = answerAfter([ticked("mobility", MONDAY)], monWed, MONDAY, [version({ weekdays: ["monday", "thursday"] })]);
    expect(answer.week).toMatchObject({ planned: 2, done: 1, met: 1 });
    expect(answerLandsAlone(clamped, "mobility", answer)).toBe(false);
  });

  it("reads again for a habit or a day the week does not hold", () => {
    expect(answerLandsAlone(read(MORNING), "sauna", answerAfter(mondayTicked, mobility, MONDAY))).toBe(false);
  });
});

describe("sameDayPlan — whether an answer's day is planned as the step holds it", () => {
  const monday = dayOf(read(MORNING), "mobility", "2026-09-28");

  it("holds when only the entry moved: the answer lands on its day alone", () => {
    const answered: HabitDayFacts = { ...monday, entry: { done: true, value: null, note: null }, met: true, edited: true };
    expect(sameDayPlan(monday, answered)).toBe(true);
  });

  it("fails when the coach moved the day's plan underneath: running, planned, its target or its times a week", () => {
    expect(sameDayPlan(monday, { ...monday, covered: false })).toBe(false);
    expect(sameDayPlan(monday, { ...monday, planned: false })).toBe(false);
    expect(sameDayPlan(monday, { ...monday, target: 3 })).toBe(false);
    expect(sameDayPlan(monday, { ...monday, timesPerWeek: 3 })).toBe(false);
  });
});
