import { describe, it, expect } from "vitest";
import {
  EMPTY_TRAINING_LOG_MESSAGE,
  EmptyTrainingLogError,
  trainingLogRecordsWork,
} from "@/lib/training-log-content";

const set = (setNumber: number) => ({ setNumber });
const exercise = (
  sets: { setNumber: number }[],
  over: { skipped?: boolean } = {}
) => ({ exerciseName: "Bench", sets, weightUnit: "kg" as const, ...over });

describe("trainingLogRecordsWork", () => {
  it("counts a set the client sent", () => {
    expect(trainingLogRecordsWork({ exercises: [exercise([set(1)])] })).toBe(true);
  });

  it("counts a set on ANY exercise, not just the first", () => {
    expect(
      trainingLogRecordsWork({
        exercises: [exercise([], { skipped: true }), exercise([set(2)])],
      })
    ).toBe(true);
  });

  it("does not count an exercise the client marked skipped", () => {
    expect(
      trainingLogRecordsWork({ exercises: [exercise([set(1)], { skipped: true })] })
    ).toBe(false);
  });

  it("does not count an exercise with no sets", () => {
    expect(trainingLogRecordsWork({ exercises: [exercise([])] })).toBe(false);
  });

  // The quick path: the client states the outcome themselves, and the wire
  // accepts only `full` or `partial`, so an exercise-less payload is always a
  // log. Both spellings of "no exercises" mean the same thing.
  it("treats a payload with no exercises as the quick path, which is always a log", () => {
    expect(trainingLogRecordsWork({})).toBe(true);
    expect(trainingLogRecordsWork({ exercises: [] })).toBe(true);
  });
});

describe("EmptyTrainingLogError", () => {
  it("carries the sentence the form shows before the tap", () => {
    expect(new EmptyTrainingLogError().message).toBe(EMPTY_TRAINING_LOG_MESSAGE);
  });
});
