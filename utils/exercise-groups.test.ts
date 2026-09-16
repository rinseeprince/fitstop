import { describe, expect, it } from "vitest";
import {
  GROUP_FORMATS,
  STRAIGHT_SETS,
  countSessionExercises,
  groupSettingsFromRow,
  groupSettingsOf,
  groupSettingsToRow,
  nestRowsIntoGroups,
  sessionExercises,
  type GroupSettings,
} from "./exercise-groups";

const CIRCUIT: GroupSettings = {
  format: "circuit",
  rounds: 3,
  timeCapSeconds: 600,
  intervalSeconds: 60,
  restBetweenExercisesSeconds: 15,
  restBetweenRoundsSeconds: 90,
  notes: "A",
};

describe("group formats", () => {
  it("are the five formats migration 178's CHECK allows, in its order", () => {
    expect(GROUP_FORMATS).toEqual(["straight_sets", "circuit", "amrap", "emom", "for_time"]);
  });

  it("a lone exercise is straight sets with nothing else set", () => {
    expect(STRAIGHT_SETS).toEqual({
      format: "straight_sets",
      rounds: null,
      timeCapSeconds: null,
      intervalSeconds: null,
      restBetweenExercisesSeconds: null,
      restBetweenRoundsSeconds: null,
      notes: null,
    });
    expect(Object.isFrozen(STRAIGHT_SETS)).toBe(true);
  });
});

describe("group settings mapping", () => {
  it("round-trips every setting through the row's columns", () => {
    const row = groupSettingsToRow(CIRCUIT);
    expect(row).toEqual({
      format: "circuit",
      rounds: 3,
      time_cap_seconds: 600,
      interval_seconds: 60,
      rest_between_exercises_seconds: 15,
      rest_between_rounds_seconds: 90,
      notes: "A",
    });
    expect(groupSettingsFromRow(row)).toEqual(CIRCUIT);
  });

  it("writes an absent setting as null, never undefined", () => {
    expect(groupSettingsToRow({ format: "emom" })).toEqual({
      format: "emom",
      rounds: null,
      time_cap_seconds: null,
      interval_seconds: null,
      rest_between_exercises_seconds: null,
      rest_between_rounds_seconds: null,
      notes: null,
    });
  });

  it("refuses a format the list does not know, loudly", () => {
    expect(() =>
      groupSettingsFromRow({ ...groupSettingsToRow(CIRCUIT), format: "tabata" }),
    ).toThrow('Unknown group format "tabata"');
  });

  it("takes only the settings off a group that carries more", () => {
    const group = { ...CIRCUIT, uid: "grp-1", exercises: [{ uid: "ex-1" }] };
    expect(groupSettingsOf(group)).toEqual(CIRCUIT);
  });
});

describe("a session's exercises", () => {
  const session = {
    groups: [
      { exercises: ["A1", "A2"] },
      { exercises: ["B1"] },
      { exercises: ["C1", "C2", "C3"] },
    ],
  };

  it("flatten group by group, each group's exercises in turn", () => {
    expect(sessionExercises(session)).toEqual(["A1", "A2", "B1", "C1", "C2", "C3"]);
    expect(countSessionExercises(session)).toBe(6);
  });

  it("are none for a session with no groups", () => {
    expect(sessionExercises({ groups: [] })).toEqual([]);
    expect(countSessionExercises({ groups: [] })).toBe(0);
  });
});

describe("nestRowsIntoGroups", () => {
  const group = (id: string, order_index: number) => ({ id, order_index });
  const exercise = (id: string, order_index: number) => ({ id, order_index });

  it("orders the groups by their place in the session and each group's exercises by their place in it, whatever order the rows arrive in", () => {
    const b = group("g-b", 1);
    const a = group("g-a", 0);
    const nested = nestRowsIntoGroups([
      { group: b, exercise: exercise("b1", 0) },
      { group: a, exercise: exercise("a2", 1) },
      { group: a, exercise: exercise("a1", 0) },
    ]);
    expect(nested.map((n) => [n.group.id, n.exercises.map((e) => e.id)])).toEqual([
      ["g-a", ["a1", "a2"]],
      ["g-b", ["b1"]],
    ]);
  });

  it("breaks a tie in position by id, so the order is the same on every read", () => {
    const nested = nestRowsIntoGroups([
      { group: group("g-2", 0), exercise: exercise("x", 0) },
      { group: group("g-1", 0), exercise: exercise("y", 0) },
    ]);
    expect(nested.map((n) => n.group.id)).toEqual(["g-1", "g-2"]);
  });

  it("knows a group only through the exercises that point at it", () => {
    expect(nestRowsIntoGroups([])).toEqual([]);
  });
});
