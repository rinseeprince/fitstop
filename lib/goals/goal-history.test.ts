import { describe, it, expect } from "vitest";
import type { ClientGoal } from "@/types/client-goals";
import { goalHistoryRows, type NutritionVersionWindow, type ProgramWindow } from "./goal-history";

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

const rows = () => goalHistoryRows({ goals: [build, leanOut, cut], today: TODAY, programs, versions });
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
    const then = goalHistoryRows({ goals: [cut, build, leanOut], today: "2026-10-19", programs, versions });
    expect(then.map((r) => r.status)).toEqual(["current", "ended", "ended"]);
  });

  it("reads an ended goal's deadline as it ended, today's as it stands, and a planned one's as it starts", () => {
    const ended = goalHistoryRows({
      goals: [cut, build, leanOut],
      today: "2026-10-20",
      programs: [],
      versions: [],
    });
    expect(ended.find((r) => r.id === "build")?.deadline).toBe("2026-10-09");
    expect(row("build").deadline).toBe("2026-10-09");
    expect(row("lean").deadline).toBe("2026-12-11");
    // Before its change, today's deadline was the one it started with
    const before = goalHistoryRows({ goals: [cut, build], today: "2026-08-11", programs: [], versions: [] });
    expect(before.find((r) => r.id === "build")?.deadline).toBe("2026-10-30");
  });

  // Its deadline changed on the day Build was set from: Cut ended the day before.
  it("never reads or lists a deadline change made the day the next goal took over", () => {
    const changedLate = goal("cut", "2026-05-04", [
      ["2026-05-04", "2026-06-26"],
      ["2026-06-29", "2026-06-27"],
    ]);
    const [, ended] = goalHistoryRows({ goals: [changedLate, build], today: TODAY, programs: [], versions: [] });
    expect(ended.deadline).toBe("2026-06-26");
    expect(ended.lines).toEqual([]);
  });

  it("is empty for a client with no goals", () => {
    expect(goalHistoryRows({ goals: [], today: TODAY, programs, versions })).toEqual([]);
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

  it("orders one day's lines as they happen: the calories, a program starting, the deadline, a program ending", () => {
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
    });
    expect(only.lines.map((line) => (line.kind === "program" ? line.change : line.kind))).toEqual([
      "nutrition",
      "starts",
      "deadline",
      "ends",
    ]);
  });

  it("gives the last goal every line after its start, however far ahead", () => {
    const [last] = goalHistoryRows({
      goals: [build],
      today: TODAY,
      programs: [{ name: "Off season", startsOn: "2027-03-01", endsOn: "2027-05-30" }],
      versions: [version("2027-03-01", "2027-05-30", 2520, 86.3, null)],
    });
    expect(last.lines.map((line) => line.on)).toEqual(["2026-08-12", "2027-03-01", "2027-03-01", "2027-05-30"]);
  });
});
