import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GOAL_DESCRIPTION_MAX, GOAL_NAME_MAX } from "@/lib/constants";
import {
  GOAL_TYPES,
  GOAL_TYPE_SETTINGS,
  goalDirection,
  goalTypeBesideName,
  goalTypeFromTargets,
  isGoalType,
  targetAgainstType,
} from "./goal-types";

// Migration 193 spells the six types in client_goals' CHECK, the name and
// description bounds in two more, and the default names once more in the
// conversion. One list and three constants hold here; the migration mirrors
// them, and this reads it so the two cannot drift.
const MIGRATION = readFileSync(
  join(__dirname, "..", "..", "supabase", "migrations", "193_goals_one_row_per_goal.sql"),
  "utf8"
);

describe("the goal type list", () => {
  it("is the list client_goals' CHECK accepts, in order", () => {
    const check = /CHECK \(type IN \(([^)]*)\)\)/.exec(MIGRATION);
    expect(check).not.toBeNull();
    const listed = [...check![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(listed).toEqual([...GOAL_TYPES]);
  });

  it("bounds a name and a description as the table does", () => {
    expect(MIGRATION).toContain(`char_length(name) <= ${GOAL_NAME_MAX}`);
    expect(MIGRATION).toContain(`char_length(description) <= ${GOAL_DESCRIPTION_MAX}`);
  });

  it("names each converted goal by the name its type gives a new one", () => {
    for (const type of GOAL_TYPES) {
      const named = new RegExp(`WHEN '${type}' THEN '([^']+)'`).exec(MIGRATION);
      // general_fitness is the conversion's ELSE branch.
      const name = named?.[1] ?? /ELSE '([^']+)'\s*END,\s*t\.type/.exec(MIGRATION)?.[1];
      expect(name).toBe(GOAL_TYPE_SETTINGS[type].name);
    }
  });

  it("knows its own members", () => {
    expect(isGoalType("recomposition")).toBe(true);
    expect(isGoalType("fat_loss")).toBe(false);
    expect(isGoalType(null)).toBe(false);
  });
});

// What each type's form asks for (docs/MEASUREMENT-LOG-PLAN.md §6 commit 8d2):
// a weight target to lose weight or build muscle, a body-fat target for a
// recomp, the event day for event prep — its deadline by that name — and
// nothing for maintaining or general fitness.
describe("what each type asks for", () => {
  it("names the one target each type needs", () => {
    expect(Object.fromEntries(GOAL_TYPES.map((type) => [type, GOAL_TYPE_SETTINGS[type].target]))).toEqual({
      lose_weight: "weight",
      build_muscle: "weight",
      recomposition: "bodyFat",
      maintain: null,
      event_prep: null,
      general_fitness: null,
    });
  });

  it("calls event prep's deadline the event day, and every other type's the deadline", () => {
    for (const type of GOAL_TYPES) {
      expect(GOAL_TYPE_SETTINGS[type].deadlineLabel).toBe(type === "event_prep" ? "Event day" : "Deadline");
    }
  });

  it("says the type beside a name only when the name does not already say it", () => {
    expect(goalTypeBesideName("lose_weight", "Lean out")).toBe("Lose weight");
    expect(goalTypeBesideName("lose_weight", "Lose weight")).toBeNull();
    expect(goalTypeBesideName("recomposition", " Recomp ")).toBeNull();
  });
});

// The form's warning: a target pointing the other way from its type.
describe("targetAgainstType", () => {
  it("catches a loss target above the reading, a gain target below it, a recomp's body fat above it", () => {
    expect(targetAgainstType("lose_weight", "weight", 84.3, 81.9)).toBe("above");
    expect(targetAgainstType("build_muscle", "weight", 69.4, 72.8)).toBe("below");
    expect(targetAgainstType("recomposition", "bodyFat", 26.5, 23.9)).toBe("above");
  });

  it("stays quiet when the target agrees with the type, or sits on the reading", () => {
    expect(targetAgainstType("lose_weight", "weight", 76.1, 81.9)).toBeNull();
    expect(targetAgainstType("build_muscle", "weight", 77.7, 72.8)).toBeNull();
    expect(targetAgainstType("recomposition", "bodyFat", 18.2, 23.9)).toBeNull();
    expect(targetAgainstType("lose_weight", "weight", 81.9, 81.9)).toBeNull();
  });

  it("stays quiet where the type decides no direction, or with no reading or no target", () => {
    expect(targetAgainstType("maintain", "weight", 88.8, 70.2)).toBeNull();
    expect(targetAgainstType("event_prep", "weight", 64.6, 70.2)).toBeNull();
    expect(targetAgainstType("lose_weight", "bodyFat", 29.9, 21.4)).toBeNull();
    expect(targetAgainstType("lose_weight", "weight", 84.3, null)).toBeNull();
    expect(targetAgainstType("build_muscle", "weight", null, 72.8)).toBeNull();
  });
});

describe("goalDirection", () => {
  it("takes the type's direction where the type decides one", () => {
    expect(goalDirection("lose_weight", "weight", 71, 64)).toBe(-1);
    expect(goalDirection("build_muscle", "weight", 83, 91)).toBe(1);
    expect(goalDirection("recomposition", "bodyFat", 18, 12)).toBe(-1);
  });

  it("falls back to the side of the start the target sits on", () => {
    expect(goalDirection("recomposition", "weight", 77, 80)).toBe(-1);
    expect(goalDirection("event_prep", "weight", 86, 82)).toBe(1);
    expect(goalDirection("maintain", "weight", 79, 79)).toBe(0);
    expect(goalDirection(null, "bodyFat", 14, 21)).toBe(-1);
  });

  it("claims no direction without a start where the type decides none", () => {
    expect(goalDirection("general_fitness", "weight", 72, null)).toBe(0);
    expect(goalDirection("lose_weight", "bodyFat", 16, undefined)).toBe(0);
  });
});

describe("goalTypeFromTargets", () => {
  it("reads a weight target against the reading", () => {
    expect(goalTypeFromTargets({ targetWeight: 68, targetBodyFatPercentage: null, reading: 74 })).toBe("lose_weight");
    expect(goalTypeFromTargets({ targetWeight: 88, targetBodyFatPercentage: 13, reading: 81 })).toBe("build_muscle");
    expect(goalTypeFromTargets({ targetWeight: 76.5, targetBodyFatPercentage: null, reading: 76.5 })).toBe("maintain");
  });

  it("makes a body-fat target alone a recomp", () => {
    expect(goalTypeFromTargets({ targetWeight: null, targetBodyFatPercentage: 17, reading: 85 })).toBe("recomposition");
  });

  it("is general fitness with no targets, or a weight target and nothing to compare it with", () => {
    expect(goalTypeFromTargets({ targetWeight: null, targetBodyFatPercentage: null, reading: 69 })).toBe("general_fitness");
    expect(goalTypeFromTargets({ targetWeight: 62, targetBodyFatPercentage: 19, reading: null })).toBe("general_fitness");
  });
});
