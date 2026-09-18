import { describe, it, expect } from "vitest";
import { summariseTraining, trainingAdherenceStatus } from "./training-adherence";
import type { TrainingWorkoutRead } from "./training-display-state";

const workout = (overrides: Partial<TrainingWorkoutRead>): TrainingWorkoutRead => ({
  status: "scheduled",
  completionQuality: null,
  ...overrides,
});

describe("trainingAdherenceStatus (the log's quality decides)", () => {
  it("counts a full log as full", () => {
    expect(
      trainingAdherenceStatus(workout({ status: "completed", completionQuality: "full" }))
    ).toBe("full");
  });

  // The event says only that the client logged it; the log says how it went,
  // and the count must follow the log exactly as the pill beside it does.
  it("counts a completed event whose log says partial as partial", () => {
    expect(
      trainingAdherenceStatus(workout({ status: "completed", completionQuality: "partial" }))
    ).toBe("partial");
  });

  it("counts a workout the client has not logged as not done", () => {
    expect(trainingAdherenceStatus(workout({ status: "scheduled" }))).toBe("missed");
  });

  // 227 rows on dev: logged before the link existed, so no quality was ever
  // recorded. A workout done at a quality nobody wrote down is a full one.
  it("counts a completed workout with no log as full", () => {
    expect(trainingAdherenceStatus(workout({ status: "completed" }))).toBe("full");
  });
});

describe("summariseTraining", () => {
  it("counts partial towards completed and excludes what was not done", () => {
    const workouts = [
      workout({ status: "completed", completionQuality: "full" }),
      workout({ status: "completed", completionQuality: "full" }),
      workout({ status: "completed", completionQuality: "full" }),
      workout({ status: "completed", completionQuality: "partial" }),
      workout({ status: "scheduled" }),
      workout({ status: "scheduled" }),
    ];

    expect(summariseTraining(workouts)).toEqual({
      planned: 6,
      completed: 4,
      full: 3,
      partial: 1,
      missed: 2,
      pct: 67,
    });
  });

  // The flip's headline, as a number: a week nobody skipped reads 100% even
  // though one of its workouts was only partly done.
  it("reads a week whose only shortfall is a partial as complete", () => {
    expect(
      summariseTraining([
        workout({ status: "completed", completionQuality: "full" }),
        workout({ status: "completed", completionQuality: "full" }),
        workout({ status: "completed", completionQuality: "full" }),
        workout({ status: "completed", completionQuality: "full" }),
        workout({ status: "completed", completionQuality: "partial" }),
      ])
    ).toEqual({
      planned: 5,
      completed: 5,
      full: 4,
      partial: 1,
      missed: 0,
      pct: 100,
    });
  });

  it("returns a null pct for a week with nothing prescribed", () => {
    expect(summariseTraining([])).toEqual({
      planned: 0,
      completed: 0,
      full: 0,
      partial: 0,
      missed: 0,
      pct: null,
    });
  });

  it("keeps full beside completed as the breakdown, never as a second count", () => {
    const summary = summariseTraining([
      workout({ status: "completed", completionQuality: "full" }),
      workout({ status: "completed", completionQuality: "partial" }),
    ]);
    // Every done-count in the product reads `completed`; `full` and `partial`
    // are what a surface prints beside it.
    expect(summary.completed).toBe(2);
    expect(summary.full).toBe(1);
    expect(summary.partial).toBe(1);
  });
});
