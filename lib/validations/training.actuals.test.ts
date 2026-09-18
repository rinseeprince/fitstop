import { describe, expect, it } from "vitest";
import { logTrainingEventSchema } from "./training";
import { LOGGED_MEASURES, SET_LOG_MEASURES, SET_LOG_TEMPO } from "@/utils/set-log-measures";

// The log wire takes one actual per measure, from the one table of actuals,
// bounded to its target's limit and refused when finer than its column's scale
// (migration 184). Canonical values, no unit tag beyond the exercise's weight tag.
function payload(set: Record<string, unknown>) {
  return {
    completionQuality: "full",
    exercises: [
      {
        trainingExerciseId: "11111111-1111-4111-8111-111111111111",
        exerciseName: "Run",
        weightUnit: "kg",
        sets: [{ setNumber: 1, ...set }],
      },
    ],
  };
}

describe("logTrainingEventSchema — every actual", () => {
  it("accepts every measure at its floor and its ceiling, and the tempo grammar", () => {
    for (const measure of LOGGED_MEASURES) {
      const { key, floor, ceiling } = SET_LOG_MEASURES[measure];
      expect(logTrainingEventSchema.safeParse(payload({ [key]: floor })).success, `${key} floor`).toBe(true);
      expect(logTrainingEventSchema.safeParse(payload({ [key]: ceiling })).success, `${key} ceiling`).toBe(true);
    }
    expect(logTrainingEventSchema.safeParse(payload({ [SET_LOG_TEMPO.key]: "3-1-X-0" })).success).toBe(true);
  });

  it("keeps every measure's value on the parsed set", () => {
    const everything = Object.fromEntries(
      LOGGED_MEASURES.map((measure) => [SET_LOG_MEASURES[measure].key, SET_LOG_MEASURES[measure].ceiling]),
    );
    const parsed = logTrainingEventSchema.safeParse(payload({ ...everything, tempo: "2-0-2-0" }));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.exercises?.[0].sets[0]).toEqual({ setNumber: 1, ...everything, tempo: "2-0-2-0" });
    }
  });

  it("refuses a value outside its limit", () => {
    for (const measure of LOGGED_MEASURES) {
      const { key, floor, ceiling, integer, scale } = SET_LOG_MEASURES[measure];
      const step = integer ? 1 : 10 ** -scale;
      expect(logTrainingEventSchema.safeParse(payload({ [key]: ceiling + step })).success, `${key} over`).toBe(false);
      expect(logTrainingEventSchema.safeParse(payload({ [key]: floor - step })).success, `${key} under`).toBe(false);
    }
  });

  it("refuses a value finer than its column's scale, and a fraction where a whole number is stored", () => {
    expect(logTrainingEventSchema.safeParse(payload({ durationSeconds: 405.3 })).success).toBe(true);
    expect(logTrainingEventSchema.safeParse(payload({ durationSeconds: 405.33 })).success).toBe(false);
    expect(logTrainingEventSchema.safeParse(payload({ distanceMeters: 4988.97 })).success).toBe(true);
    expect(logTrainingEventSchema.safeParse(payload({ distanceMeters: 4988.966 })).success).toBe(false);
    expect(logTrainingEventSchema.safeParse(payload({ rpe: 8.5 })).success).toBe(true);
    expect(logTrainingEventSchema.safeParse(payload({ rpe: 8.25 })).success).toBe(false);
    expect(logTrainingEventSchema.safeParse(payload({ paceSecondsPerKm: 285.5 })).success).toBe(false);
    expect(logTrainingEventSchema.safeParse(payload({ heartRateZone: 2.5 })).success).toBe(false);
  });

  it("refuses a tempo off the four-phase grammar", () => {
    expect(logTrainingEventSchema.safeParse(payload({ tempo: "3-1-1" })).success).toBe(false);
    expect(logTrainingEventSchema.safeParse(payload({ tempo: "slow" })).success).toBe(false);
  });

  it("still takes a set that carries nothing but its number", () => {
    expect(logTrainingEventSchema.safeParse(payload({})).success).toBe(true);
  });
});
