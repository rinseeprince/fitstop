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
  // accepts only `full` or `partial`, so a payload with no exercises KEY is
  // always a log. An empty list is not that: a list present replaces what the
  // log holds, so an empty one clears the sets and records nothing by itself.
  it("treats a payload with no exercises key as the quick path, which is always a log", () => {
    expect(trainingLogRecordsWork({})).toBe(true);
  });

  it("does not count an empty exercises list — it clears the sets", () => {
    expect(trainingLogRecordsWork({ exercises: [] })).toBe(false);
  });

  // §4.7 amendment 1: from commit 14 a timed group's score counts.
  it("counts a timed group's score, with or without sets", () => {
    const score = { groupId: "11111111-1111-4111-8111-111111111111", rounds: 7, reps: 12 };
    expect(trainingLogRecordsWork({ exercises: [], groupScores: [score] })).toBe(true);
    expect(trainingLogRecordsWork({ groupScores: [score] })).toBe(true);
    expect(trainingLogRecordsWork({ exercises: [exercise([])], groupScores: [] })).toBe(false);
  });
});

describe("EmptyTrainingLogError", () => {
  it("carries the sentence the form shows before the tap", () => {
    expect(new EmptyTrainingLogError().message).toBe(EMPTY_TRAINING_LOG_MESSAGE);
  });
});
