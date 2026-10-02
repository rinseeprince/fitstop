import { describe, it, expect } from "vitest";
import { describeDay } from "./ai-prompt-day";
import { habitsOnDay, habitWeekLines } from "./ai-prompt-habits";
import { habitSectionNotes, habitSectionRows } from "@/lib/check-in/habit-section-rows";
import type { SentHabitWeek } from "@/lib/check-in/sent-snapshot";

/**
 * How a version 3 habit week reaches the AI (commit 6 of
 * docs/HABITS-REBUILD-PLAN.md): each habit's week with its days, its target,
 * its figure and a number habit's average; each day with every habit planned
 * or entered on it — planned or not, the entry against that day's target, met
 * or not, the note. The pinned text of `ai-prompt-builder.test.ts` holds the
 * whole prompt for a fixture week.
 */

type Row = SentHabitWeek["habits"][number];
type Day = Row["days"][number];

const day = (date: string, facts: Partial<Day> = {}): Day => ({
  date,
  covered: true,
  planned: false,
  target: null,
  entry: null,
  met: false,
  ...facts,
});

const EVERY_DAY = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const version = (overrides: Partial<Row["versions"][number]>): Row["versions"][number] => ({
  startsOn: "2026-09-01",
  endsOn: null,
  target: null,
  timesPerWeek: null,
  weekdays: [...EVERY_DAY],
  ...overrides,
});

function row(overrides: Partial<Row>): Row {
  return {
    id: "h",
    name: "Habit",
    measure: "tick",
    unit: null,
    direction: null,
    firstStartsOn: "2026-09-01",
    versions: [version({})],
    days: [],
    figures: { planned: 0, done: 0, met: 0 },
    ...overrides,
  };
}

const MON = "2026-09-28";
const TUE = "2026-09-29";

const week: SentHabitWeek = {
  habits: [
    // Mon, Wed, Fri: missed the Monday, made it up on the Tuesday.
    row({
      id: "mobility",
      name: "Mobility",
      versions: [version({ weekdays: ["monday", "wednesday", "friday"] })],
      days: [day(MON, { planned: true }), day(TUE, { entry: { done: true, value: null, note: null }, met: true })],
      figures: { planned: 1, done: 1, met: 1 },
    }),
    // Three times a week: no day is planned; done on the Tuesday.
    row({
      id: "sauna",
      name: "Sauna",
      versions: [version({ timesPerWeek: 3, weekdays: [] })],
      days: [day(MON), day(TUE, { entry: { done: true, value: null, note: "Late one" }, met: true })],
      figures: { planned: 2, done: 1, met: 1 },
    }),
    // At least 3 L: short on the Monday, met on the Tuesday.
    row({
      id: "water",
      name: "Water",
      measure: "number",
      unit: "L",
      direction: "at_least",
      versions: [version({ target: 3 })],
      days: [
        day(MON, { planned: true, target: 3, entry: { done: null, value: 2.4, note: "Travelling" } }),
        day(TUE, { planned: true, target: 3, entry: { done: null, value: 3.1, note: null }, met: true }),
      ],
      figures: { planned: 2, done: 1, met: 1 },
    }),
    // Stopped before the week: covered on no day.
    row({ id: "read", name: "Read", days: [day(MON, { covered: false }), day(TUE, { covered: false })] }),
  ],
  totals: { planned: 5, done: 3, met: 3 },
};

/** Long walk, Sundays: planned on neither day, done on the Tuesday anyway, with a note. */
const walk = row({
  id: "walk",
  name: "Long walk",
  versions: [version({ weekdays: ["sunday"] })],
  days: [day(MON), day(TUE, { entry: { done: true, value: null, note: "Hotel gym" }, met: true })],
  figures: { planned: 0, done: 1, met: 0 },
});

describe("habitsOnDay — a day's habits as the AI reads them", () => {
  it("lists each habit planned that day with its entry against that day's target: a number short of it is not met", () => {
    expect(habitsOnDay(week, MON)).toEqual([
      { name: "Mobility", plan: "planned", target: null, entry: "not done", met: false, note: null },
      { name: "Water", plan: "planned", target: "at least 3 L", entry: "2.4 L, not met", met: false, note: "Travelling" },
    ]);
  });

  it("lists a habit entered on a day it was not planned, and a habit done N times a week as any day, never not planned", () => {
    expect(habitsOnDay(week, TUE)).toEqual([
      { name: "Mobility", plan: "not planned", target: null, entry: "done", met: true, note: null },
      { name: "Sauna", plan: "any day of the week", target: null, entry: "done", met: true, note: "Late one" },
      { name: "Water", plan: "planned", target: "at least 3 L", entry: "3.1 L, met", met: true, note: null },
    ]);
  });

  it("says nothing of an unplanned day whose only entry is a tick taken back with no note, and says not done on a planned one", () => {
    const unticked = row({
      id: "stretch",
      name: "Stretch",
      versions: [version({ weekdays: ["monday"] })],
      days: [
        day(MON, { planned: true, entry: { done: false, value: null, note: null } }),
        day(TUE, { entry: { done: false, value: null, note: null } }),
      ],
      figures: { planned: 1, done: 0, met: 0 },
    });
    const both: SentHabitWeek = { habits: [unticked], totals: unticked.figures };
    expect(habitsOnDay(both, MON)).toEqual([
      { name: "Stretch", plan: "planned", target: null, entry: "not done", met: false, note: null },
    ]);
    expect(habitsOnDay(both, TUE)).toEqual([]);
  });

  it("says nothing of a habit on a day it was not running, or of a week with no habits", () => {
    expect(habitsOnDay(week, MON).map((habit) => habit.name)).not.toContain("Read");
    expect(habitsOnDay(null, MON)).toEqual([]);
  });

  it("says a planned number habit with nothing entered had nothing entered, never met or not met", () => {
    const empty = row({
      name: "Steps",
      measure: "number",
      unit: "steps",
      direction: "at_least",
      versions: [version({ target: 8000 })],
      days: [day(MON, { planned: true, target: 8000 })],
    });
    expect(habitsOnDay({ habits: [empty], totals: empty.figures }, MON)).toEqual([
      { name: "Steps", plan: "planned", target: "at least 8,000 steps", entry: "nothing entered", met: false, note: null },
    ]);
  });

  it("writes the day's habits on one line: planned or not, the target, the entry and the note", () => {
    const text = describeDay({
      date: MON,
      logged: true,
      workouts: [],
      exerciseLines: new Map(),
      nutrition: null,
      dailyLog: null,
      habits: habitsOnDay(week, MON),
    });
    expect(text).toContain(
      'Habits: Mobility (planned): not done; Water (planned, at least 3 L): 2.4 L, not met, note "Travelling"'
    );
  });
});

describe("habitWeekLines — the week's habits as the Habits section shows them", () => {
  it("gives the habit days done over the days planned, then each habit planned with its days, target, figure and average", () => {
    expect(habitWeekLines(week)).toEqual([
      "Habits: 3/5 habit days done",
      "  Mobility (Mon, Wed, Fri): 1/1 days done",
      "  Sauna (3 times a week): 1/2 days done",
      "  Water (Every day · at least 3 L): 1/2 days done, avg 2.8 L",
    ]);
  });

  it("counts a week done more often than planned as its planned days, never more", () => {
    // Planned on the Monday alone, done on both days: 1 of 1, not 2 of 1.
    const extra = row({
      name: "Stretch",
      versions: [version({ weekdays: ["monday"] })],
      days: [
        day(MON, { planned: true, entry: { done: true, value: null, note: null }, met: true }),
        day(TUE, { entry: { done: true, value: null, note: null }, met: true }),
      ],
      figures: { planned: 1, done: 2, met: 1 },
    });
    expect(habitWeekLines({ habits: [extra], totals: extra.figures })).toEqual([
      "Habits: 1/1 habit days done",
      "  Stretch (Mon): 1/1 days done",
    ]);
  });

  it("words a habit the week did not plan but the client entered as nothing planned, and the total as nothing planned when no habit was", () => {
    expect(habitWeekLines({ habits: [walk], totals: walk.figures })).toEqual([
      "Habits: nothing planned this week",
      "  Long walk (Sun): nothing planned",
    ]);
  });

  it("is absent when the week neither planned nor saw entered any habit", () => {
    expect(habitWeekLines({ habits: [row({ name: "Read" })], totals: { planned: 0, done: 0, met: 0 } })).toEqual([]);
    expect(habitWeekLines(null)).toEqual([]);
  });
});

describe("the AI and the review's Habits section read the same habits", () => {
  it("names on a day only a habit the section lists, and only a note the section shows", () => {
    // Read: stopped before the week, with an entry and a note kept from before its stop.
    const kept = row({
      id: "read",
      name: "Read",
      days: [day(MON, { covered: false, entry: { done: true, value: null, note: "Old" } }), day(TUE, { covered: false })],
    });
    const all: SentHabitWeek = { habits: [...week.habits.filter((habit) => habit.id !== "read"), kept, walk], totals: week.totals };

    const listed = habitSectionRows(all).map((each) => each.name);
    const notes = habitSectionNotes(all).map((each) => [each.date, each.habit, each.note]);
    const named = [MON, TUE].flatMap((date) => habitsOnDay(all, date).map((habit) => ({ date, habit })));
    expect(named.length).toBeGreaterThan(0);
    for (const { date, habit } of named) {
      expect(listed).toContain(habit.name);
      if (habit.note) expect(notes).toContainEqual([date, habit.name, habit.note]);
    }
    // The section's notes are the AI's: none the AI is not given either.
    expect(notes).toEqual(named.flatMap(({ date, habit }) => (habit.note ? [[date, habit.name, habit.note]] : [])));
    expect(listed).toEqual(["Mobility", "Sauna", "Water", "Long walk"]);
  });
});
