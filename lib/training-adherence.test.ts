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

  it("counts a partial log as partial", () => {
    expect(
      trainingAdherenceStatus(workout({ status: "partial", completionQuality: "partial" }))
    ).toBe("partial");
  });

  // The one row on dev that carries it: the event says completed, the log says
  // partial. This is commit 10's safety net — the count must follow the log,
  // exactly as the pill beside it does.
  it("counts a completed event whose log says partial as partial", () => {
    expect(
      trainingAdherenceStatus(workout({ status: "completed", completionQuality: "partial" }))
    ).toBe("partial");
  });

  it("counts an empty log as not done", () => {
    expect(
      trainingAdherenceStatus(workout({ status: "skipped", completionQuality: "skipped" }))
    ).toBe("missed");
  });

  it("counts a workout the client has not logged as not done", () => {
    expect(trainingAdherenceStatus(workout({ status: "scheduled" }))).toBe("missed");
  });

  // 209 rows on dev: logged before the link existed, so no quality was ever
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
      workout({ status: "partial", completionQuality: "partial" }),
      workout({ status: "scheduled" }),
      workout({ status: "skipped", completionQuality: "skipped" }),
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

  it("keeps full and completed apart — the two numerators in the product", () => {
    const summary = summariseTraining([
      workout({ status: "completed", completionQuality: "full" }),
      workout({ status: "partial", completionQuality: "partial" }),
    ]);
    // The coach's review reads `completed`; the client's wizard and the stored
    // column read `full`.
    expect(summary.full).toBe(1);
    expect(summary.completed).toBe(2);
  });
});
