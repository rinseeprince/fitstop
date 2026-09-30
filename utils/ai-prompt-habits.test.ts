import { describe, it, expect } from "vitest";
import { habitsOnDay } from "./ai-prompt-day";
import { habitWeekLine } from "./ai-prompt-week";
import type { SentHabitWeek } from "@/lib/check-in/sent-snapshot";

/**
 * How a version 3 habit week reaches the AI (commit 2 of
 * docs/HABITS-REBUILD-PLAN.md): the pinned text of `ai-prompt-builder.test.ts`
 * holds for a copy saved before version 3; these hold what a set-days, a
 * weekly and a number habit add.
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

function row(overrides: Partial<Row>): Row {
  return {
    id: "h",
    name: "Habit",
    measure: "tick",
    unit: null,
    direction: null,
    firstStartsOn: "2026-09-01",
    versions: [],
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
      days: [
        day(MON, { planned: true }),
        day(TUE, { entry: { done: true, value: null, note: null }, met: true }),
      ],
      figures: { planned: 1, done: 1, met: 1 },
    }),
    // Three times a week: no day is planned; done on the Tuesday.
    row({
      id: "sauna",
      name: "Sauna",
      days: [day(MON), day(TUE, { entry: { done: true, value: null, note: null }, met: true })],
      figures: { planned: 2, done: 1, met: 1 },
    }),
    // At least 3 L: short on the Monday, met on the Tuesday.
    row({
      id: "water",
      name: "Water",
      measure: "number",
      unit: "L",
      direction: "at_least",
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

describe("habitsOnDay — a day's habits as the AI reads them", () => {
  it("lists each habit planned that day, ticked when met — a number short of its target is not ticked", () => {
    expect(habitsOnDay(week, MON)).toEqual([
      { name: "Mobility", ticked: false },
      { name: "Water", ticked: false },
    ]);
  });

  it("lists a habit entered on a day it was not planned, and leaves out an unplanned day nothing was entered on", () => {
    expect(habitsOnDay(week, TUE)).toEqual([
      { name: "Mobility", ticked: true },
      { name: "Sauna", ticked: true },
      { name: "Water", ticked: true },
    ]);
  });

  it("says nothing of a habit on a day it was not running, or of a week with no habits", () => {
    expect(habitsOnDay(week, MON).map((habit) => habit.name)).not.toContain("Read");
    expect(habitsOnDay(null, MON)).toEqual([]);
  });
});

describe("habitWeekLine — the week's habits in one line", () => {
  it("gives each habit planned that week its days met of its days planned", () => {
    expect(habitWeekLine(week)).toBe("Habits: Mobility 1/1 days; Sauna 1/2 days; Water 1/2 days");
  });

  it("counts a week done more often than planned as its planned days, never more", () => {
    // Planned on the Monday alone, done on both days: 1 of 1, not 2 of 1.
    const extra = row({
      name: "Stretch",
      days: [
        day(MON, { planned: true, entry: { done: true, value: null, note: null }, met: true }),
        day(TUE, { entry: { done: true, value: null, note: null }, met: true }),
      ],
      figures: { planned: 1, done: 2, met: 1 },
    });
    expect(habitWeekLine({ habits: [extra], totals: extra.figures })).toBe("Habits: Stretch 1/1 days");
  });

  it("is absent with nothing planned", () => {
    expect(habitWeekLine({ habits: [row({ name: "Read" })], totals: { planned: 0, done: 0, met: 0 } })).toBeNull();
    expect(habitWeekLine(null)).toBeNull();
  });
});
