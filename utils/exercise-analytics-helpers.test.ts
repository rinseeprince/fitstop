import { describe, it, expect } from "vitest";
import {
  calculateEpleyE1RM,
  resolveExerciseIdentityKey,
  exerciseLogMatchesTarget,
} from "./exercise-analytics-helpers";

describe("calculateEpleyE1RM", () => {
  it("calculates correctly for normal inputs", () => {
    // 100 * (1 + 10/30) = 100 * 1.333... ≈ 133.33
    expect(calculateEpleyE1RM(100, 10)).toBeCloseTo(133.33, 1);
  });

  it("returns weight directly for 1-rep set", () => {
    expect(calculateEpleyE1RM(150, 1)).toBe(150);
  });

  it("returns null for zero weight", () => {
    expect(calculateEpleyE1RM(0, 5)).toBeNull();
  });

  it("returns null for negative weight", () => {
    expect(calculateEpleyE1RM(-50, 5)).toBeNull();
  });

  it("returns null for zero reps", () => {
    expect(calculateEpleyE1RM(100, 0)).toBeNull();
  });

  it("returns null for reps > 30", () => {
    expect(calculateEpleyE1RM(100, 31)).toBeNull();
  });

  it("handles boundary reps = 30", () => {
    // 100 * (1 + 30/30) = 200
    expect(calculateEpleyE1RM(100, 30)).toBe(200);
  });
});

describe("resolveExerciseIdentityKey", () => {
  it("prefers exercise_logs.exercise_id when present", () => {
    expect(resolveExerciseIdentityKey("uuid-1", "uuid-2", "Bench Press")).toBe(
      "uuid-1"
    );
  });

  it("falls back to training_exercises.exercise_id", () => {
    expect(resolveExerciseIdentityKey(null, "uuid-2", "Bench Press")).toBe(
      "uuid-2"
    );
  });

  it("falls back to lowercased performed_name", () => {
    expect(resolveExerciseIdentityKey(null, null, "Bench Press")).toBe(
      "bench press"
    );
  });

  it("returns 'unknown' when all are null", () => {
    expect(resolveExerciseIdentityKey(null, null, null)).toBe("unknown");
  });
});

describe("exerciseLogMatchesTarget", () => {
  it("matches via exercise_logs.exercise_id", () => {
    expect(
      exerciseLogMatchesTarget(
        { exerciseId: "ex-1", trainingExerciseExerciseId: null, performedName: null },
        { exerciseId: "ex-1" }
      )
    ).toBe(true);
  });

  it("matches via training_exercises.exercise_id", () => {
    expect(
      exerciseLogMatchesTarget(
        { exerciseId: null, trainingExerciseExerciseId: "ex-1", performedName: null },
        { exerciseId: "ex-1" }
      )
    ).toBe(true);
  });

  it("matches via name fallback (case-insensitive)", () => {
    expect(
      exerciseLogMatchesTarget(
        { exerciseId: null, trainingExerciseExerciseId: null, performedName: "Bench Press" },
        { exerciseName: "bench press" }
      )
    ).toBe(true);
  });

  it("does not match when no paths align", () => {
    expect(
      exerciseLogMatchesTarget(
        { exerciseId: "ex-2", trainingExerciseExerciseId: null, performedName: "Squat" },
        { exerciseId: "ex-1", exerciseName: "Bench Press" }
      )
    ).toBe(false);
  });

  it("does not match name when performedName is null", () => {
    expect(
      exerciseLogMatchesTarget(
        { exerciseId: null, trainingExerciseExerciseId: null, performedName: null },
        { exerciseName: "Bench Press" }
      )
    ).toBe(false);
  });
});
