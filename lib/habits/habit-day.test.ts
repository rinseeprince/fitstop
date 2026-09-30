import { describe, it, expect } from "vitest";
import { habitDay, habitStatus, versionForWords, versionOn, versionsOver } from "./habit-day";
import type { ClientHabit, HabitVersion } from "@/types/habits";

// 28 Sep 2026 is a Monday; 4 Oct the Sunday after.
const MON_WED_FRI: HabitVersion["weekdays"] = ["monday", "wednesday", "friday"];

function version(overrides: Partial<HabitVersion> = {}): HabitVersion {
  return {
    id: "version-a",
    startsOn: "2026-09-01",
    endsOn: null,
    target: null,
    timesPerWeek: null,
    weekdays: MON_WED_FRI,
    ...overrides,
  };
}

function habit(overrides: Partial<ClientHabit> = {}): ClientHabit {
  return {
    id: "habit-1",
    name: "Mobility",
    howTo: null,
    measure: "tick",
    unit: null,
    direction: null,
    position: 1,
    versions: [version()],
    dayEdits: [],
    ...overrides,
  };
}

describe("habitDay", () => {
  it("plans a set-days version's weekdays and leaves its other days covered but unplanned", () => {
    const mobility = habit();
    expect(habitDay(mobility, "2026-09-28")).toMatchObject({ covered: true, planned: true, edited: false });
    expect(habitDay(mobility, "2026-09-29")).toMatchObject({ covered: true, planned: false, edited: false });
  });

  it("covers nothing outside its versions: before the first day, after the last, in a gap", () => {
    const stopped = habit({
      versions: [
        version({ startsOn: "2026-09-10", endsOn: "2026-09-20" }),
        version({ id: "version-b", startsOn: "2026-10-01" }),
      ],
    });
    for (const date of ["2026-09-09", "2026-09-21", "2026-09-30"]) {
      expect(habitDay(stopped, date)).toEqual({
        date,
        covered: false,
        planned: false,
        target: null,
        edited: false,
        versionId: null,
        timesPerWeek: null,
      });
    }
    expect(habitDay(stopped, "2026-09-20").covered).toBe(true);
    expect(habitDay(stopped, "2026-10-01").versionId).toBe("version-b");
  });

  it("reads each day against the version covering it when the version changes mid-week", () => {
    const changed = habit({
      measure: "number",
      unit: "L",
      direction: "at_least",
      versions: [
        version({ endsOn: "2026-09-30", target: 3 }),
        version({ id: "version-b", startsOn: "2026-10-01", target: 3.5, weekdays: ["thursday", "saturday"] }),
      ],
    });
    expect(habitDay(changed, "2026-09-30")).toMatchObject({ planned: true, target: 3, versionId: "version-a" });
    expect(habitDay(changed, "2026-10-01")).toMatchObject({ planned: true, target: 3.5, versionId: "version-b" });
    expect(habitDay(changed, "2026-10-02")).toMatchObject({ planned: false, target: 3.5 });
  });

  it("plans no particular day of a version done N times a week, and keeps its target", () => {
    const sauna = habit({
      measure: "number",
      unit: "min",
      direction: "at_least",
      versions: [version({ timesPerWeek: 3, weekdays: [], target: 15 })],
      dayEdits: [{ date: "2026-09-28", planned: true, target: 20 }],
    });
    expect(habitDay(sauna, "2026-09-28")).toMatchObject({
      covered: true,
      planned: false,
      target: 15,
      edited: false,
      timesPerWeek: 3,
    });
  });

  it("says a set-days habit's day is not a times-a-week day, planned or not", () => {
    const mobility = habit();
    expect(habitDay(mobility, "2026-09-28").timesPerWeek).toBeNull();
    expect(habitDay(mobility, "2026-09-29").timesPerWeek).toBeNull();
  });

  it("lets a one-date edit take a planned day off, and put an unplanned day on at its own target", () => {
    const water = habit({
      measure: "number",
      unit: "L",
      direction: "at_least",
      versions: [version({ target: 3 })],
      dayEdits: [
        { date: "2026-09-28", planned: false, target: null },
        { date: "2026-09-29", planned: true, target: 2 },
        { date: "2026-10-01", planned: true, target: null },
      ],
    });
    expect(habitDay(water, "2026-09-28")).toMatchObject({ planned: false, target: 3, edited: true });
    expect(habitDay(water, "2026-09-29")).toMatchObject({ planned: true, target: 2, edited: true });
    expect(habitDay(water, "2026-10-01")).toMatchObject({ planned: true, target: 3, edited: true });
    expect(habitDay(water, "2026-09-30")).toMatchObject({ planned: true, target: 3, edited: false });
  });
});

describe("versionOn and versionForWords", () => {
  const history = habit({
    versions: [
      version({ startsOn: "2026-09-01", endsOn: "2026-09-10" }),
      version({ id: "version-b", startsOn: "2026-09-15", endsOn: "2026-09-20", weekdays: ["tuesday"] }),
      version({ id: "version-c", startsOn: "2026-10-05" }),
    ],
  });

  it("finds the one version covering a day", () => {
    expect(versionOn(history, "2026-09-16")?.id).toBe("version-b");
    expect(versionOn(history, "2026-09-12")).toBeNull();
  });

  it("finds every version running on a day of a span, its ends included", () => {
    expect(versionsOver(history, "2026-09-10", "2026-09-15").map((v) => v.id)).toEqual(["version-a", "version-b"]);
    expect(versionsOver(history, "2026-09-11", "2026-09-14")).toEqual([]);
    expect(versionsOver(history, "2026-09-21", "2026-10-05").map((v) => v.id)).toEqual(["version-c"]);
    expect(versionsOver(history, "2026-12-01", "2026-12-07").map((v) => v.id)).toEqual(["version-c"]);
  });

  it("reads a stopped habit's words from its last version, and a habit not started yet from its first", () => {
    expect(versionForWords(history, "2026-09-16")?.id).toBe("version-b");
    expect(versionForWords(history, "2026-09-25")?.id).toBe("version-b");
    expect(versionForWords(history, "2026-08-20")?.id).toBe("version-a");
    expect(versionForWords(habit({ versions: [] }), "2026-09-25")).toBeNull();
  });
});

describe("habitStatus", () => {
  const history = habit({
    versions: [
      version({ startsOn: "2026-09-01", endsOn: "2026-09-10" }),
      version({ id: "version-b", startsOn: "2026-09-15", endsOn: "2026-09-20" }),
      version({ id: "version-c", startsOn: "2026-10-05" }),
    ],
  });

  it("is running on a day a version covers, its first and last days included", () => {
    expect(habitStatus(history, "2026-09-16")).toBe("running");
    expect(habitStatus(history, "2026-09-15")).toBe("running");
    expect(habitStatus(history, "2026-09-20")).toBe("running");
    expect(habitStatus(history, "2026-10-05")).toBe("running");
  });

  it("is upcoming in a gap with a version queued after it, and before its first version", () => {
    expect(habitStatus(history, "2026-09-25")).toBe("upcoming");
    expect(habitStatus(history, "2026-08-20")).toBe("upcoming");
  });

  it("is stopped once its last version has ended, and with no version at all", () => {
    const stopped = habit({ versions: [version({ endsOn: "2026-09-10" })] });
    expect(habitStatus(stopped, "2026-09-11")).toBe("stopped");
    expect(habitStatus(stopped, "2026-09-10")).toBe("running");
    expect(habitStatus(habit({ versions: [] }), "2026-09-25")).toBe("stopped");
  });
});
