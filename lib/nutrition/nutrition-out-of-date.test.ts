import { describe, it, expect } from "vitest";
import type { ClientGoal } from "@/types/client-goals";
import { findNutritionOutOfDate, type NutritionVersionGoal } from "./nutrition-out-of-date";

const TODAY = "2026-09-23";

function goal(
  id: string,
  startsOn: string,
  deadlines: Array<[effectiveOn: string, deadline: string | null]>,
  targetWeight: number | null,
  targetBodyFatPercentage: number | null = null
): ClientGoal {
  return {
    id,
    clientId: "client-4",
    name: `Goal ${id}`,
    type: "lose_weight",
    targetWeight,
    targetBodyFatPercentage,
    description: null,
    startsOn,
    source: "coach",
    setBy: null,
    createdAt: "2026-07-01T08:00:00Z",
    updatedAt: "2026-07-01T08:00:00Z",
    deadlines: deadlines.map(([effectiveOn, deadline]) => ({ effectiveOn, deadline, setBy: null })),
  };
}

function version(
  id: string,
  effectiveFrom: string,
  effectiveUntil: string,
  goalWeightKg: number | null,
  deadline: string | null
): NutritionVersionGoal {
  return { id, effectiveFrom, effectiveUntil, built: { goalWeightKg, deadline } };
}

// Lean out runs from 6 Aug, 81.5 kg by 9 Nov; Build is planned from 19 Oct.
const leanOut = goal("lean", "2026-08-06", [["2026-08-06", "2026-11-09"]], 81.5);
const build = goal("build", "2026-10-19", [["2026-10-19", "2027-01-20"]], 84.2);

describe("findNutritionOutOfDate", () => {
  it("is out of date from today when today's goal is not the one the version was built for", () => {
    const running = version("v-run", "2026-09-01", "2026-10-31", 80.3, "2026-10-01");
    expect(findNutritionOutOfDate([running], [leanOut], TODAY)).toEqual({
      versionId: "v-run",
      fromDay: TODAY,
      built: { goalWeightKg: 80.3, deadline: "2026-10-01" },
      goal: { goalWeightKg: 81.5, deadline: "2026-11-09" },
      goalName: "Goal lean",
    });
  });

  it("flags a planned goal from its own day, and not the day before", () => {
    const running = version("v-run", "2026-09-01", "2026-10-31", 81.5, "2026-11-09");
    const found = findNutritionOutOfDate([running], [leanOut, build], TODAY);
    expect(found?.fromDay).toBe("2026-10-19");
    expect(found?.goal).toEqual({ goalWeightKg: 84.2, deadline: "2027-01-20" });
    // The goal named is the one in force on that day, not today's.
    expect(found?.goalName).toBe("Goal build");
    // The same version, ending the day before Build: every day it covers is
    // Lean out's, so nothing is out of date.
    const endsBefore = version("v-run", "2026-09-01", "2026-10-18", 81.5, "2026-11-09");
    expect(findNutritionOutOfDate([endsBefore], [leanOut, build], TODAY)).toBeNull();
  });

  it("flags a new weight target on the same deadline", () => {
    const retargeted = goal("lean-2", TODAY, [[TODAY, "2026-11-09"]], 79.8);
    const running = version("v-run", "2026-09-01", "2026-10-31", 81.5, "2026-11-09");
    const found = findNutritionOutOfDate([running], [leanOut, retargeted], TODAY);
    expect(found?.fromDay).toBe(TODAY);
    expect(found?.goal).toEqual({ goalWeightKg: 79.8, deadline: "2026-11-09" });
  });

  it("flags a deadline change from the day it took effect", () => {
    const moved = goal(
      "lean",
      "2026-08-06",
      [
        ["2026-08-06", "2026-11-09"],
        [TODAY, "2026-12-04"],
      ],
      81.5
    );
    const running = version("v-run", "2026-09-01", "2026-10-31", 81.5, "2026-11-09");
    const found = findNutritionOutOfDate([running], [moved], TODAY);
    expect(found?.fromDay).toBe(TODAY);
    expect(found?.goal.deadline).toBe("2026-12-04");
  });

  it("judges a queued version from its own start, never from today", () => {
    // Queued from 1 Nov and built for Lean out, while Build starts 19 Oct: its
    // first day is already Build's.
    const queued = version("v-queued", "2026-11-01", "2026-12-20", 81.5, "2026-11-09");
    expect(findNutritionOutOfDate([queued], [leanOut, build], TODAY)?.fromDay).toBe("2026-11-01");
    // Built for Build, it is up to date on every day it covers.
    const forBuild = version("v-queued", "2026-11-01", "2026-12-20", 84.2, "2027-01-20");
    expect(findNutritionOutOfDate([forBuild], [leanOut, build], TODAY)).toBeNull();
  });

  it("never judges days before today", () => {
    // Built for a goal that ran until yesterday; from today it is right again.
    const earlier = goal("earlier", "2026-07-01", [["2026-07-01", null]], 79.6);
    const lean = goal("lean", TODAY, [[TODAY, "2026-11-09"]], 81.5);
    const running = version("v-run", "2026-09-01", "2026-10-31", 81.5, "2026-11-09");
    expect(findNutritionOutOfDate([running], [earlier, lean], TODAY)).toBeNull();
    // A version that has ended is history, whatever it was built for.
    const ended = version("v-ended", "2026-08-01", "2026-09-22", 70.1, null);
    expect(findNutritionOutOfDate([ended], [leanOut], TODAY)).toBeNull();
  });

  it("reports the earliest day across the versions", () => {
    const running = version("v-run", "2026-09-01", "2026-10-31", 81.5, "2026-11-09");
    const queued = version("v-queued", "2026-11-01", "2026-12-20", 83.7, "2026-12-31");
    const found = findNutritionOutOfDate([queued, running], [leanOut, build], TODAY);
    expect(found?.versionId).toBe("v-run");
    expect(found?.fromDay).toBe("2026-10-19");
  });

  it("is not out of date when only something calories never read changed", () => {
    // A new goal from today with the same weight target and deadline: only the
    // body fat target moved.
    const recomposed = goal("new", TODAY, [[TODAY, "2026-11-09"]], 81.5, 18.4);
    const running = version("v-run", "2026-09-01", "2026-10-31", 81.5, "2026-11-09");
    expect(findNutritionOutOfDate([running], [leanOut, recomposed], TODAY)).toBeNull();
  });

  it("reads no goal as maintenance, on both sides", () => {
    const maintenance = version("v-maint", "2026-09-01", "2026-10-31", null, null);
    expect(findNutritionOutOfDate([maintenance], [], TODAY)).toBeNull();
    const priced = version("v-priced", "2026-09-01", "2026-10-31", 82.9, "2026-12-01");
    expect(findNutritionOutOfDate([priced], [], TODAY)).toEqual({
      versionId: "v-priced",
      fromDay: TODAY,
      built: { goalWeightKg: 82.9, deadline: "2026-12-01" },
      goal: { goalWeightKg: null, deadline: null },
      goalName: null,
    });
  });
});
