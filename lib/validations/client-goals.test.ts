import { describe, it, expect } from "vitest";
import {
  addGoalSchema,
  editGoalSchema,
  firstGoalSchema,
  goalDeadlineSchema,
  renameGoalSchema,
} from "./client-goals";

describe("addGoalSchema", () => {
  it("takes a type that needs no target alone — the name and the day are optional", () => {
    expect(addGoalSchema.safeParse({ type: "general_fitness" }).success).toBe(true);
  });

  it("takes only the six types", () => {
    expect(addGoalSchema.safeParse({ type: "fat_loss" }).success).toBe(false);
  });

  it("bounds a weight target in kilograms and a body-fat target in percent", () => {
    expect(addGoalSchema.safeParse({ type: "lose_weight", targetWeight: 19.5 }).success).toBe(false);
    expect(addGoalSchema.safeParse({ type: "lose_weight", targetWeight: 251 }).success).toBe(false);
    expect(addGoalSchema.safeParse({ type: "recomposition", targetBodyFatPercentage: 2.5 }).success).toBe(false);
    expect(addGoalSchema.safeParse({ type: "recomposition", targetBodyFatPercentage: 61 }).success).toBe(false);
    expect(
      addGoalSchema.safeParse({ type: "lose_weight", targetWeight: 64.3, targetBodyFatPercentage: 18.5 }).success
    ).toBe(true);
  });

  it("wants days as YYYY-MM-DD, and leaves the date rules to the goal functions", () => {
    expect(addGoalSchema.safeParse({ type: "maintain", startsOn: "03/10/2026" }).success).toBe(false);
    // A day already past on the server's clock is the functions' question, judged on the client's today.
    expect(addGoalSchema.safeParse({ type: "maintain", startsOn: "2020-01-06", deadline: "2020-02-03" }).success).toBe(true);
  });

  it("trims a name and refuses one that is blank or too long", () => {
    const parsed = addGoalSchema.safeParse({ type: "event_prep", name: "  Spring race  " });
    expect(parsed.success && parsed.data.name).toBe("Spring race");
    expect(addGoalSchema.safeParse({ type: "event_prep", name: "   " }).success).toBe(false);
    expect(addGoalSchema.safeParse({ type: "event_prep", name: "x".repeat(81) }).success).toBe(false);
  });
});

describe("editGoalSchema", () => {
  const whole = {
    type: "build_muscle",
    name: "Winter build",
    targetWeight: 86.2,
    targetBodyFatPercentage: null,
    description: null,
    startsOn: "2026-11-02",
    deadline: null,
  };

  it("takes the goal whole", () => {
    expect(editGoalSchema.safeParse(whole).success).toBe(true);
  });

  it("refuses a partial goal", () => {
    const { startsOn: _startsOn, ...partial } = whole;
    expect(editGoalSchema.safeParse(partial).success).toBe(false);
  });
});

describe("the small schemas", () => {
  it("takes a deadline or none", () => {
    expect(goalDeadlineSchema.safeParse({ deadline: null }).success).toBe(true);
    expect(goalDeadlineSchema.safeParse({ deadline: "2027-05-21" }).success).toBe(true);
    expect(goalDeadlineSchema.safeParse({}).success).toBe(false);
  });

  it("renames with a description or none", () => {
    expect(renameGoalSchema.safeParse({ name: "Cut", description: null }).success).toBe(true);
    expect(renameGoalSchema.safeParse({ name: "Cut", description: "x".repeat(501) }).success).toBe(false);
  });
});

// The form asks for what a goal's type uses (docs/MEASUREMENT-LOG-PLAN.md §6
// commit 8d2), and every way a goal is written holds it: a weight to lose
// weight or build muscle, a body fat for a recomp, nothing for the others. A
// target the type does not ask for stays the coach's to add.
describe("the target a goal's type needs", () => {
  it("losing weight and building muscle need a weight target", () => {
    for (const type of ["lose_weight", "build_muscle"]) {
      const missing = addGoalSchema.safeParse({ type, targetBodyFatPercentage: 23.4 });
      expect(missing.success).toBe(false);
      expect(missing.error?.issues[0]?.path).toEqual(["targetWeight"]);
      expect(addGoalSchema.safeParse({ type, targetWeight: 72.6 }).success).toBe(true);
    }
  });

  it("a recomp needs a body-fat target, and a weight alone will not do", () => {
    const missing = addGoalSchema.safeParse({ type: "recomposition", targetWeight: 66.9 });
    expect(missing.success).toBe(false);
    expect(missing.error?.issues[0]?.path).toEqual(["targetBodyFatPercentage"]);
    expect(addGoalSchema.safeParse({ type: "recomposition", targetBodyFatPercentage: 15.5 }).success).toBe(true);
  });

  it("maintaining, event prep and general fitness need none, and take one the coach adds", () => {
    for (const type of ["maintain", "event_prep", "general_fitness"]) {
      expect(addGoalSchema.safeParse({ type }).success).toBe(true);
      expect(addGoalSchema.safeParse({ type, targetWeight: 90.1 }).success).toBe(true);
    }
  });

  it("holds on a whole rewrite and on a first goal alike", () => {
    const rewrite = {
      type: "lose_weight",
      name: "Lean out",
      targetWeight: null,
      targetBodyFatPercentage: 12.5,
      description: null,
      startsOn: "2026-12-07",
      deadline: null,
    };
    expect(editGoalSchema.safeParse(rewrite).success).toBe(false);
    expect(editGoalSchema.safeParse({ ...rewrite, targetWeight: 70.4 }).success).toBe(true);
    expect(firstGoalSchema.safeParse({ type: "build_muscle" }).success).toBe(false);
    expect(firstGoalSchema.safeParse({ type: "build_muscle", targetWeight: 88.3 }).success).toBe(true);
  });
});
