import { describe, it, expect } from "vitest";

import { habitDayGroups, habitGroupOf, habitRowWords, habitWeekWords, noteAnswer } from "./habit-day-groups";
import type { ClientHabitDayItem, HabitDayFacts, HabitIdentity } from "@/types/habits";

// The plan's client on Tuesday 29 September (docs/HABITS-REBUILD-PLAN.md
// §2.5), after making up Monday's mobility: Water every day, Sauna three
// times a week, Mobility on Monday, Wednesday and Friday.
const DATE = "2026-09-29";

function item(
  habit: Partial<HabitIdentity> & { id: string },
  day: Partial<HabitDayFacts>,
  words: Partial<ClientHabitDayItem["words"]> = {}
): ClientHabitDayItem {
  return {
    habit: { name: habit.id, howTo: null, measure: "tick", unit: null, direction: null, ...habit },
    day: { date: DATE, covered: true, planned: true, target: null, edited: false, versionId: "v", timesPerWeek: null, entry: null, met: false, ...day },
    week: { planned: 3, done: 2, met: 2, start: "2026-09-24", end: "2026-09-30" },
    words: { schedule: "Every day", target: null, week: "2 of 3", ...words },
  };
}

const water = item(
  { id: "water", measure: "number", unit: "L", direction: "at_least" },
  { target: 3, entry: { done: null, value: 3, note: null }, met: true },
  { target: "at least 3 L", week: "4 of 7" }
);
const sauna = item({ id: "sauna" }, { planned: false, timesPerWeek: 3 }, { schedule: "3 times a week" });
const mobility = item(
  { id: "mobility" },
  { planned: false, entry: { done: true, value: null, note: null }, met: true },
  { schedule: "Mon, Wed, Fri" }
);
// A number habit on another weekday: its days, then its target.
const steps = item(
  { id: "steps", measure: "number", unit: "steps", direction: "at_least" },
  { planned: false, target: 6000 },
  { schedule: "Mon, Wed, Fri", target: "at least 6,000 steps" }
);

describe("the day's groups", () => {
  it("puts each habit where its day puts it: planned, any day this week, not planned", () => {
    expect([water, sauna, mobility].map(habitGroupOf)).toEqual(["planned", "any-day", "not-planned"]);
  });

  it("puts a habit done N times a week in any day this week, never in planned or not planned", () => {
    expect(habitGroupOf({ ...sauna, day: { ...sauna.day, planned: true } })).toBe("any-day");
  });

  it("follows a one-date edit: a day taken off is not planned, a day put on is planned", () => {
    expect(habitGroupOf({ ...water, day: { ...water.day, planned: false, edited: true } })).toBe("not-planned");
    expect(habitGroupOf({ ...mobility, day: { ...mobility.day, planned: true, edited: true } })).toBe("planned");
  });

  it("lists the groups in the page's order, each in the coach's order, leaving out a group with no habit", () => {
    const groups = habitDayGroups([mobility, sauna, steps, water], DATE, DATE);
    expect(groups.map((group) => [group.key, group.items.map((each) => each.habit.id)])).toEqual([
      ["planned", ["water"]],
      ["any-day", ["sauna"]],
      ["not-planned", ["mobility", "steps"]],
    ]);
    expect(habitDayGroups([mobility], DATE, DATE).map((group) => group.key)).toEqual(["not-planned"]);
    expect(habitDayGroups([], DATE, DATE)).toEqual([]);
  });

  it("says today on the client's today alone; another day's page names its date above", () => {
    expect(habitDayGroups([water, sauna, mobility], DATE, DATE).map((group) => group.label)).toEqual([
      "Planned today",
      "Any day this week",
      "Not planned today",
    ]);
    // Wednesday, the same client week: no "today", still this week.
    expect(habitDayGroups([water, sauna, mobility], DATE, "2026-09-30").map((group) => group.label)).toEqual([
      "Planned",
      "Any day this week",
      "Not planned",
    ]);
  });

  it("says that week of a week that does not hold the client's today, on either side of it", () => {
    for (const today of ["2026-10-01", "2026-09-23"]) {
      expect(habitDayGroups([water, sauna, mobility], DATE, today).map((group) => group.label)).toEqual([
        "Planned",
        "Any day that week",
        "Not planned",
      ]);
    }
    // The week's own ends hold it.
    expect(habitDayGroups([sauna], DATE, "2026-09-24")[0].label).toBe("Any day this week");
    expect(habitDayGroups([sauna], DATE, "2026-09-30")[0].label).toBe("Any day this week");
  });
});

describe("a row's words", () => {
  it("gives a planned number habit its target that day, and a planned tick habit none", () => {
    expect(habitRowWords(water, "planned")).toBe("at least 3 L");
    expect(habitRowWords(item({ id: "stretch" }, {}), "planned")).toBeNull();
  });

  it("gives a habit not planned that day the days that are, then a number habit's target", () => {
    expect(habitRowWords(mobility, "not-planned")).toBe("Mon, Wed, Fri");
    expect(habitRowWords(steps, "not-planned")).toBe("Mon, Wed, Fri · at least 6,000 steps");
  });

  it("gives a habit done N times a week no days of its own: its group and its figure say it", () => {
    expect(habitRowWords(sauna, "any-day")).toBeNull();
    const run = item({ id: "run", measure: "number", unit: "km", direction: "at_least" }, { timesPerWeek: 3 }, { schedule: "3 times a week", target: "at least 5 km" });
    expect(habitRowWords(run, "any-day")).toBe("at least 5 km");
  });

  it("reads the week as the server spelled it, this week", () => {
    expect(habitWeekWords(water, DATE)).toBe("4 of 7 this week");
    expect(habitWeekWords(item({ id: "later" }, {}, { week: "Nothing planned" }), DATE)).toBe("Nothing planned this week");
  });

  it("reads another week as that week", () => {
    expect(habitWeekWords(water, "2026-10-01")).toBe("4 of 7 that week");
    expect(habitWeekWords(item({ id: "later" }, {}, { week: "Nothing planned" }), "2026-09-23")).toBe("Nothing planned that week");
  });
});

describe("the answer a note rides on", () => {
  it("is a tick habit's tick as the day shows it: not done until ticked", () => {
    expect(noteAnswer(mobility)).toEqual({ done: true });
    expect(noteAnswer(sauna)).toEqual({ done: false });
    expect(noteAnswer(item({ id: "nap" }, { entry: { done: false, value: null, note: "Tired" } }))).toEqual({ done: false });
  });

  it("is a number habit's number, and none before it has one", () => {
    expect(noteAnswer(water)).toEqual({ value: 3 });
    expect(noteAnswer(steps)).toBeNull();
    // Zero is a number: a note can ride on it.
    expect(noteAnswer({ ...steps, day: { ...steps.day, entry: { done: null, value: 0, note: null } } })).toEqual({ value: 0 });
  });
});
