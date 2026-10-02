import { describe, it, expect } from "vitest";
import type { ClientGoal } from "@/types/client-goals";
import type { HabitVersion } from "@/types/habits";
import { goalHistoryRows, type HabitVersions, type NutritionVersionWindow, type ProgramWindow } from "./goal-history";

function goal(
  id: string,
  startsOn: string,
  deadlines: Array<[effectiveOn: string, deadline: string | null]>,
  type: ClientGoal["type"] = "lose_weight"
): ClientGoal {
  return {
    id,
    clientId: "client-3",
    name: `Goal ${id}`,
    type,
    targetWeight: 79.4,
    targetBodyFatPercentage: null,
    description: null,
    startsOn,
    source: "coach",
    setBy: null,
    createdAt: "2026-04-01T08:00:00Z",
    updatedAt: "2026-04-01T08:00:00Z",
    deadlines: deadlines.map(([effectiveOn, deadline]) => ({ effectiveOn, deadline, setBy: null })),
  };
}

const version = (
  startsOn: string,
  endsOn: string,
  calories: number,
  goalWeightKg: number | null,
  deadline: string | null
): NutritionVersionWindow => ({ startsOn, endsOn, calories, builtFor: { goalWeightKg, deadline } });

const EVERY_DAY = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

/** A habit's version, every day with no target unless said. */
const habitVersion = (startsOn: string, endsOn: string | null, over: Partial<HabitVersion> = {}): HabitVersion => ({
  id: `v-${startsOn}`,
  startsOn,
  endsOn,
  target: null,
  timesPerWeek: null,
  weekdays: [...EVERY_DAY],
  ...over,
});
const tickHabit = (name: string, versions: HabitVersion[]): HabitVersions => ({
  name,
  measure: "tick",
  unit: null,
  direction: null,
  versions,
});
const numberHabit = (name: string, unit: string, versions: HabitVersion[]): HabitVersions => ({
  name,
  measure: "number",
  unit,
  direction: "at_least",
  versions,
});

const TODAY = "2026-09-23";

// Cut ran 4 May – 28 Jun; Build is today's goal, its deadline brought forward on
// 12 Aug; Lean out is planned from 19 Oct.
const cut = goal("cut", "2026-05-04", [["2026-05-04", "2026-06-26"]]);
const build = goal(
  "build",
  "2026-06-29",
  [
    ["2026-06-29", "2026-10-30"],
    ["2026-08-12", "2026-10-09"],
  ],
  "build_muscle"
);
const leanOut = goal("lean", "2026-10-19", [["2026-10-19", "2026-12-11"]]);

// Base was running when Cut began; Strength replaced it inside Cut, and
// Hypertrophy replaced Strength on Build's first day; Hypertrophy ended with a
// gap before Peak, which ends inside Lean out.
const programs: ProgramWindow[] = [
  { name: "Base", startsOn: "2026-04-06", endsOn: "2026-05-17" },
  { name: "Strength", startsOn: "2026-05-18", endsOn: "2026-06-28" },
  { name: "Hypertrophy", startsOn: "2026-06-29", endsOn: "2026-08-23" },
  { name: "Peak", startsOn: "2026-09-07", endsOn: "2026-11-01" },
];

const versions = [
  version("2026-04-20", "2026-05-31", 2380, 79.4, "2026-06-26"),
  version("2026-06-01", "2026-07-12", 2240, 79.4, "2026-06-26"),
  version("2026-07-13", "2026-10-18", 2710, 84.6, "2026-10-30"),
  version("2026-10-19", "2026-12-11", 2150, 81.5, "2026-12-11"),
];

const rows = () => goalHistoryRows({ goals: [build, leanOut, cut], today: TODAY, programs, versions, habits: [] });
const row = (id: string) => rows().find((r) => r.id === id)!;

describe("goalHistoryRows — the rows", () => {
  it("lists every goal newest first, so the planned ones lead", () => {
    expect(rows().map((r) => r.id)).toEqual(["lean", "build", "cut"]);
  });

  it("gives each goal its last day — the day before the next starts — and the last none", () => {
    expect(rows().map((r) => [r.id, r.endsOn])).toEqual([
      ["lean", null],
      ["build", "2026-10-18"],
      ["cut", "2026-06-28"],
    ]);
  });

  it("says which is planned, which is today's and which has ended, by the client's today", () => {
    expect(rows().map((r) => r.status)).toEqual(["planned", "current", "ended"]);
    // On Lean out's first day it is today's goal and Build has ended
    const then = goalHistoryRows({ goals: [cut, build, leanOut], today: "2026-10-19", programs, versions, habits: [] });
    expect(then.map((r) => r.status)).toEqual(["current", "ended", "ended"]);
  });

  it("reads an ended goal's deadline as it ended, today's as it stands, and a planned one's as it starts", () => {
    const ended = goalHistoryRows({
      goals: [cut, build, leanOut],
      today: "2026-10-20",
      programs: [],
      versions: [],
      habits: [],
    });
    expect(ended.find((r) => r.id === "build")?.deadline).toBe("2026-10-09");
    expect(row("build").deadline).toBe("2026-10-09");
    expect(row("lean").deadline).toBe("2026-12-11");
    // Before its change, today's deadline was the one it started with
    const before = goalHistoryRows({ goals: [cut, build], today: "2026-08-11", programs: [], versions: [], habits: [] });
    expect(before.find((r) => r.id === "build")?.deadline).toBe("2026-10-30");
  });

  // Its deadline changed on the day Build was set from: Cut ended the day before.
  it("never reads or lists a deadline change made the day the next goal took over", () => {
    const changedLate = goal("cut", "2026-05-04", [
      ["2026-05-04", "2026-06-26"],
      ["2026-06-29", "2026-06-27"],
    ]);
    const [, ended] = goalHistoryRows({ goals: [changedLate, build], today: TODAY, programs: [], versions: [], habits: [] });
    expect(ended.deadline).toBe("2026-06-26");
    expect(ended.lines).toEqual([]);
  });

  it("is empty for a client with no goals", () => {
    expect(goalHistoryRows({ goals: [], today: TODAY, programs, versions, habits: [] })).toEqual([]);
  });
});

describe("goalHistoryRows — what happened during each goal", () => {
  it("lists a goal's deadline changes, never the deadline it started with", () => {
    expect(row("build").lines.filter((line) => line.kind === "deadline")).toEqual([
      { kind: "deadline", on: "2026-08-12", from: "2026-10-30", to: "2026-10-09" },
    ]);
    expect(row("cut").lines.some((line) => line.kind === "deadline")).toBe(false);
  });

  it("lists every nutrition version whose days meet the goal's, one begun before it included", () => {
    const calories = (id: string) =>
      row(id).lines.flatMap((line) => (line.kind === "nutrition" ? [line.calories] : []));
    expect(calories("cut")).toEqual([2380, 2240]);
    expect(calories("build")).toEqual([2240, 2710]);
    expect(calories("lean")).toEqual([2150]);
    expect(row("build").lines.find((line) => line.kind === "nutrition")).toEqual({
      kind: "nutrition",
      on: "2026-06-01",
      until: "2026-07-12",
      calories: 2240,
      builtFor: { goalWeightKg: 79.4, deadline: "2026-06-26" },
    });
  });

  it("reads a program replacing the one that ended the day before, and an ending only where none follows", () => {
    const programLines = (id: string) => row(id).lines.filter((line) => line.kind === "program");
    expect(programLines("cut")).toEqual([
      { kind: "program", on: "2026-05-18", change: "replaces", name: "Strength", replaced: "Base" },
    ]);
    expect(programLines("build")).toEqual([
      { kind: "program", on: "2026-06-29", change: "replaces", name: "Hypertrophy", replaced: "Strength" },
      { kind: "program", on: "2026-08-23", change: "ends", name: "Hypertrophy" },
      { kind: "program", on: "2026-09-07", change: "starts", name: "Peak" },
    ]);
    // The planned goal's days hold Peak's end, ahead of today
    expect(programLines("lean")).toEqual([{ kind: "program", on: "2026-11-01", change: "ends", name: "Peak" }]);
  });

  it("gives a goal's last day to it, and the next goal's first day to the next", () => {
    const [later, earlier] = goalHistoryRows({
      goals: [cut, build],
      today: TODAY,
      programs: [{ name: "Deload", startsOn: "2026-06-15", endsOn: "2026-06-28" }],
      versions: [version("2026-06-28", "2026-07-26", 2615, 84.6, "2026-10-30")],
      habits: [],
    });
    expect(earlier.lines.map((line) => [line.kind, line.on])).toEqual([
      ["program", "2026-06-15"],
      ["nutrition", "2026-06-28"],
      ["program", "2026-06-28"],
    ]);
    // The version begun on Cut's last day runs on into Build
    expect(later.lines.map((line) => [line.kind, line.on])).toEqual([
      ["nutrition", "2026-06-28"],
      ["deadline", "2026-08-12"],
    ]);
  });

  it("puts each goal's lines in date order", () => {
    expect(row("build").lines.map((line) => line.on)).toEqual([
      "2026-06-01",
      "2026-06-29",
      "2026-07-13",
      "2026-08-12",
      "2026-08-23",
      "2026-09-07",
    ]);
  });

  it("orders one day's lines as they happen: the calories, a program starting, the habits stopping, then those starting in the client's order, the deadline, a program ending", () => {
    const sprint = goal(
      "sprint",
      "2026-07-06",
      [
        ["2026-07-06", "2026-08-28"],
        ["2026-07-20", "2026-08-14"],
      ]
    );
    const [only] = goalHistoryRows({
      goals: [sprint],
      today: "2026-07-27",
      programs: [{ name: "Test day", startsOn: "2026-07-20", endsOn: "2026-07-20" }],
      versions: [version("2026-07-20", "2026-08-31", 2090, null, null)],
      // The client's order is Walk, Sauna, Bike: Walk and Bike start the day Sauna stops.
      habits: [
        tickHabit("Walk", [habitVersion("2026-07-20", null)]),
        tickHabit("Sauna", [habitVersion("2026-07-06", "2026-07-19")]),
        tickHabit("Bike", [habitVersion("2026-07-20", null)]),
      ],
    });
    expect(only.lines.map((line) => (line.kind === "program" ? line.change : line.kind === "habit" ? `${line.name} ${line.change}` : line.kind))).toEqual([
      "Sauna added",
      "nutrition",
      "starts",
      "Sauna stopped",
      "Walk added",
      "Bike added",
      "deadline",
      "ends",
    ]);
  });

  // The coach deleted a logged Water today, added Water again from today and
  // moved it to the top: the old one's stop reads before the new one's start.
  it("reads a habit stopped before one started the same day, whatever the client's order", () => {
    const [, current] = goalHistoryRows({
      goals: [build, leanOut],
      today: "2026-10-02",
      programs: [],
      versions: [],
      habits: [
        numberHabit("Water", "L", [habitVersion("2026-10-02", null, { target: 3 })]),
        numberHabit("Water", "L", [habitVersion("2026-09-01", "2026-10-01", { target: 2.5 })]),
      ],
    });
    expect(current.lines.flatMap((line) => (line.kind === "habit" ? [`${line.on} ${line.change}`] : []))).toEqual([
      "2026-09-01 added",
      "2026-10-02 stopped",
      "2026-10-02 added",
    ]);
  });

  it("gives the last goal every line after its start, however far ahead", () => {
    const [last] = goalHistoryRows({
      goals: [build],
      today: TODAY,
      programs: [{ name: "Off season", startsOn: "2027-03-01", endsOn: "2027-05-30" }],
      versions: [version("2027-03-01", "2027-05-30", 2520, 86.3, null)],
      habits: [],
    });
    expect(last.lines.map((line) => line.on)).toEqual(["2026-08-12", "2027-03-01", "2027-03-01", "2027-05-30"]);
  });
});

describe("goalHistoryRows — the habits added, changed, stopped and started again during each goal", () => {
  // Water ran from before Cut and went up on Cut's first day; it stops on Lean
  // out's first day, ahead of today. Steps began with Build and went up on the
  // day Build's deadline moved. Sauna ran three times a week, stopped, and
  // started again on set days.
  const water = numberHabit("Water", "L", [
    habitVersion("2026-04-20", "2026-05-03", { target: 3 }),
    habitVersion("2026-05-04", "2026-10-18", { target: 3.5 }),
  ]);
  const steps = numberHabit("Steps", "steps", [
    habitVersion("2026-06-29", "2026-08-11", { target: 8000 }),
    habitVersion("2026-08-12", null, { target: 10000 }),
  ]);
  const sauna = tickHabit("Sauna", [
    habitVersion("2026-07-06", "2026-08-30", { timesPerWeek: 3, weekdays: [] }),
    habitVersion("2026-09-14", null, { weekdays: ["monday", "wednesday", "friday"] }),
  ]);
  const habitRows = (habits: HabitVersions[]) =>
    goalHistoryRows({ goals: [cut, build, leanOut], today: TODAY, programs: [], versions: [], habits });
  const habitLinesOf = (id: string, habits: HabitVersions[] = [water, steps, sauna]) =>
    habitRows(habits)
      .find((r) => r.id === id)!
      .lines.filter((line) => line.kind === "habit");

  const stepsFrom8000 = { schedule: "Every day", target: "at least 8,000 steps" };

  it("lists a habit's first version as added, with its days and its target in words", () => {
    expect(habitLinesOf("build", [steps, sauna]).filter((line) => line.change === "added")).toEqual([
      { kind: "habit", on: "2026-06-29", change: "added", name: "Steps", words: stepsFrom8000 },
      { kind: "habit", on: "2026-07-06", change: "added", name: "Sauna", words: { schedule: "3 times a week", target: null } },
    ]);
  });

  it("lists a version that follows one with no day between as changed, saying what changed, and no stop", () => {
    expect(habitLinesOf("build", [steps])).toEqual([
      { kind: "habit", on: "2026-06-29", change: "added", name: "Steps", words: stepsFrom8000 },
      { kind: "habit", on: "2026-08-12", change: "changed", name: "Steps", from: "at least 8,000 steps", to: "at least 10,000 steps" },
    ]);
  });

  it("lists a habit stopped on the first day it no longer runs, and started again by a version after the gap", () => {
    expect(habitLinesOf("build", [sauna])).toEqual([
      { kind: "habit", on: "2026-07-06", change: "added", name: "Sauna", words: { schedule: "3 times a week", target: null } },
      { kind: "habit", on: "2026-08-31", change: "stopped", name: "Sauna" },
      { kind: "habit", on: "2026-09-14", change: "started_again", name: "Sauna", words: { schedule: "Mon, Wed, Fri", target: null } },
    ]);
  });

  // Water's first version began before Cut, so it is listed on no goal; its
  // change on Cut's first day is a change, read off the version before it.
  it("reads the versions before the first goal, listing none of their lines", () => {
    expect(habitLinesOf("cut")).toEqual([
      { kind: "habit", on: "2026-05-04", change: "changed", name: "Water", from: "at least 3 L", to: "at least 3.5 L" },
    ]);
    expect(habitRows([water]).flatMap((r) => r.lines).some((line) => line.kind === "habit" && line.change === "added")).toBe(false);
  });

  it("lists a stop dated ahead of today on the goal whose days hold it", () => {
    expect(habitLinesOf("lean")).toEqual([{ kind: "habit", on: "2026-10-19", change: "stopped", name: "Water" }]);
  });

  it("lists no change where a version follows one with the same days and target", () => {
    const walk = tickHabit("Walk", [habitVersion("2026-07-01", "2026-07-31"), habitVersion("2026-08-01", null)]);
    expect(habitLinesOf("build", [walk])).toEqual([
      { kind: "habit", on: "2026-07-01", change: "added", name: "Walk", words: { schedule: "Every day", target: null } },
    ]);
  });
});
