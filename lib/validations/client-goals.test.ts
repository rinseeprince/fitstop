import { describe, it, expect } from "vitest";
import {
  addGoalSchema,
  editGoalSchema,
  goalDeadlineSchema,
  renameGoalSchema,
  restoreGoalSchema,
  updateGoalsSchema,
} from "./client-goals";

describe("addGoalSchema", () => {
  it("takes a type alone — every target, the name and the day are optional", () => {
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

  it("restores from a copy string", () => {
    expect(restoreGoalSchema.safeParse({ undo: "payload.signature" }).success).toBe(true);
    expect(restoreGoalSchema.safeParse({ undo: "" }).success).toBe(false);
  });
});

describe("updateGoalsSchema (the details sheet, until 8d2)", () => {
  it("needs at least one field", () => {
    expect(updateGoalsSchema.safeParse({}).success).toBe(false);
  });

  it("clears a body-fat target or a deadline with null, never the weight target", () => {
    expect(updateGoalsSchema.safeParse({ goalBodyFatPercentage: null }).success).toBe(true);
    expect(updateGoalsSchema.safeParse({ goalDeadline: null }).success).toBe(true);
    expect(updateGoalsSchema.safeParse({ goalWeight: null }).success).toBe(false);
  });
});
