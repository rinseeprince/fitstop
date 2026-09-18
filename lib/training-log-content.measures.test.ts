import { describe, expect, it } from "vitest";
import { trainingLogRecordsWork } from "./training-log-content";

// Amendment 1 to section 4.7 of the training upgrade plan: a set with any
// recorded value counts as logged. On the wire a set IS the claim, whatever it
// carries, so a set holding only a distance — no tick's worth of reps or
// weight — records work exactly as a set with nothing in it does.
describe("trainingLogRecordsWork — measurement columns", () => {
  const exercise = (sets: Record<string, unknown>[]) => ({
    exercises: [{ exerciseName: "Run", weightUnit: "kg" as const, sets: sets as never }],
  });

  it("a set carrying only a distance records work", () => {
    expect(trainingLogRecordsWork(exercise([{ setNumber: 1, distanceMeters: 5000 }]))).toBe(true);
  });

  it("a set carrying only a duration or only a split records work", () => {
    expect(trainingLogRecordsWork(exercise([{ setNumber: 1, durationSeconds: 1500 }]))).toBe(true);
    expect(trainingLogRecordsWork(exercise([{ setNumber: 1, splitSecondsPer500m: 112.3 }]))).toBe(true);
  });

  it("an exercise with no sets still records nothing", () => {
    expect(trainingLogRecordsWork(exercise([]))).toBe(false);
  });
});
