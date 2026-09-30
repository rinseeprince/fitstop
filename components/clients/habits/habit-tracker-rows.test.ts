import { describe, it, expect } from "vitest";
import { habitTrackerRows, movableHabitIds } from "./habit-tracker-rows";
import type { CoachHabit, CoachHabitList, CoachHabitWeek, CoachHabitWeekRow, HabitDayFacts, HabitVersion } from "@/types/habits";

const TODAY = "2026-09-30";
const DATES = ["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"];
const EVERY_DAY = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

const version = (startsOn: string, over: Partial<HabitVersion> = {}): HabitVersion => ({
  id: `v-${startsOn}`,
  startsOn,
  endsOn: null,
  target: null,
  timesPerWeek: null,
  weekdays: [...EVERY_DAY],
  ...over,
});

function habit(name: string, status: CoachHabit["status"], over: Partial<CoachHabit> = {}): CoachHabit {
  return {
    id: name,
    name,
    howTo: null,
    measure: "tick",
    unit: null,
    direction: null,
    position: 0,
    versions: [version("2026-09-01")],
    dayEdits: [],
    hasEntries: false,
    status,
    words: { schedule: "Every day", target: null },
    ...over,
  };
}

const day = (date: string): HabitDayFacts => ({
  date,
  covered: true,
  planned: true,
  target: null,
  edited: false,
  versionId: "v",
  timesPerWeek: null,
  entry: null,
  met: false,
});

function weekRow(
  id: string,
  words: CoachHabitWeekRow["words"] = { schedule: "Every day", target: null },
  deleted = false
): CoachHabitWeekRow {
  return {
    habit: { id, name: id, howTo: null, measure: "tick", unit: null, direction: null },
    words,
    days: DATES.map(day),
    figures: { planned: 7, done: 2, met: 2 },
    deleted,
  };
}

const week = (rows: CoachHabitWeekRow[], dates = DATES): CoachHabitWeek => ({
  clientToday: TODAY,
  start: dates[0],
  end: dates[6],
  dates,
  habits: rows,
  totals: { planned: 0, done: 0, met: 0 },
  today: null,
});

const list = (habits: CoachHabit[]): CoachHabitList => ({ clientToday: TODAY, habits });

describe("habitTrackerRows — one row per habit, the week's days on each", () => {
  it("lists the running and starting-later habits first, then the stopped, each in the client's order, then any deleted habit the week shows", () => {
    const rows = habitTrackerRows(
      list([
        habit("Water", "running"),
        habit("Sauna", "stopped", { versions: [version("2026-08-01", { endsOn: "2026-09-11" })] }),
        habit("Steps", "upcoming", { versions: [version("2026-10-12")] }),
        habit("Mobility", "running"),
      ]),
      week([weekRow("Water"), weekRow("Mobility"), weekRow("Stretch", undefined, true)])
    );
    expect(rows.map((row) => row.name)).toEqual(["Water", "Steps", "Mobility", "Sauna", "Stretch"]);
  });

  it("gives each habit the week's days and figures, or none when no version covers a day of it", () => {
    const rows = habitTrackerRows(list([habit("Water", "running"), habit("Steps", "upcoming", { versions: [version("2026-10-12")] })]), week([weekRow("Water")]));
    expect(rows[0].days).toHaveLength(7);
    expect(rows[0].figures).toEqual({ planned: 7, done: 2, met: 2 });
    expect(rows[1].days).toBeNull();
    expect(rows[1].figures).toBeNull();
  });

  // The owner's lines, dictated at commit 2's smoke: days THEN target; a
  // habit starting later its day first; a stopped habit "Stopped" alone — no
  // date, no days.
  it("writes line 2 as the days then the target, a later start first, a stopped habit Stopped alone, a deleted one Deleted", () => {
    const rows = habitTrackerRows(
      list([
        habit("Water", "running", { measure: "number", unit: "L", direction: "at_least", words: { schedule: "Every day", target: "at least 3 L" } }),
        habit("Steps", "upcoming", {
          measure: "number",
          unit: "steps",
          direction: "at_least",
          versions: [version("2026-10-12", { target: 8000, weekdays: ["monday", "wednesday", "friday"] })],
          words: { schedule: "Mon, Wed, Fri", target: "at least 8,000 steps" },
        }),
        habit("Sauna", "stopped", { words: { schedule: "3 times a week", target: null } }),
      ]),
      week([weekRow("Water"), weekRow("Stretch", undefined, true)])
    );
    expect(rows.map((row) => row.line)).toEqual([
      "Every day · at least 3 L",
      "Starts 12 Oct · Mon, Wed, Fri · at least 8,000 steps",
      "Stopped",
      "Deleted",
    ]);
  });

  // A stopped habit queued to start again has not had that version yet: the
  // line reads the version it starts with, never the last it ran.
  it("reads a habit queued to start again by the version it starts with", () => {
    const [row] = habitTrackerRows(
      list([
        habit("Water", "upcoming", {
          measure: "number",
          unit: "L",
          direction: "at_least",
          versions: [version("2026-08-01", { endsOn: "2026-09-11", target: 2 }), version("2026-10-05", { target: 3 })],
          words: { schedule: "Every day", target: "at least 2 L" },
        }),
      ]),
      week([])
    );
    expect(row.line).toBe("Starts 5 Oct · Every day · at least 3 L");
  });

  it("words a running habit as it is today on the week holding today, and as that week had it on another", () => {
    const water = habit("Water", "running", { words: { schedule: "Every day", target: "at least 3 L" } });
    const then = { schedule: "Mon, Wed, Fri", target: "at least 2 L" };
    const lastWeek = ["2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23"];
    expect(habitTrackerRows(list([water]), week([weekRow("Water", then)]))[0].line).toBe("Every day · at least 3 L");
    expect(habitTrackerRows(list([water]), week([weekRow("Water", then)], lastWeek))[0].line).toBe("Mon, Wed, Fri · at least 2 L");
  });

  it("offers a deleted habit nothing to change, and reads stopped and deleted rows quieter", () => {
    const rows = habitTrackerRows(list([habit("Water", "running"), habit("Sauna", "stopped")]), week([weekRow("Stretch", undefined, true)]));
    expect(rows.map((row) => [row.name, row.habit?.id ?? null, row.quiet])).toEqual([
      ["Water", "Water", false],
      ["Sauna", "Sauna", true],
      ["Stretch", null, true],
    ]);
  });

  // "Deleted" is the week read's own word. A habit the week shows and the list
  // does not — one just added in another window, before the list catches up —
  // is no deleted one: its days show, with nothing to change on it yet.
  it("never calls a habit deleted because the list does not hold it", () => {
    const [row] = habitTrackerRows(list([]), week([weekRow("Journal", { schedule: "Mon, Wed, Fri", target: null })]));
    expect(row).toMatchObject({ name: "Journal", line: "Mon, Wed, Fri", habit: null, quiet: false });
    expect(row.days).toHaveLength(7);
  });
});

describe("movableHabitIds — the habits a move reorders", () => {
  it("is the running and starting-later habits, in the client's order, never a stopped one", () => {
    expect(movableHabitIds(list([habit("a", "running"), habit("b", "stopped"), habit("c", "upcoming")]))).toEqual(["a", "c"]);
  });
});
