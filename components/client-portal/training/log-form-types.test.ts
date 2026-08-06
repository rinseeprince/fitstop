import { describe, it, expect } from "vitest";
import { buildLogPayload, emptySet } from "./log-form-types";
import type { LogFormValues, SetRowValues } from "./log-form-types";

const KG_PER_LB = 0.45359237;

function values(sets: SetRowValues[]): LogFormValues {
  return {
    completionQuality: "full",
    notes: "",
    exercises: [
      {
        trainingExerciseId: "11111111-1111-4111-8111-111111111111",
        exerciseId: undefined,
        exerciseName: "Bench Press",
        prescribedName: "Bench Press",
        isSwapped: false,
        skipped: false,
        notes: "",
        sets,
        isUnplanned: false,
      },
    ],
  };
}

const NOTHING_DIRTY = () => false;
const ALL_DIRTY = () => true;
const setsOf = (payload: ReturnType<typeof buildLogPayload>) =>
  payload.exercises![0].sets;

// The form seeds its weight field from canonical kilograms, rounded for
// legibility, and submits in the client's unit. Both halves of that round trip
// are lossy, so an untouched weight must resubmit the kilograms it came from
// rather than being re-parsed from the string it was shown as.
describe("buildLogPayload", () => {
  it("always tags the wire canonical, whatever the client sees", () => {
    const payload = buildLogPayload(
      values([{ reps: "10", weight: "225", rpe: "", weightKg: null }]),
      "imperial",
      ALL_DIRTY,
    );
    expect(payload.exercises![0].weightUnit).toBe("kg");
  });

  it("converts an edited weight from the client's unit to kilograms", () => {
    const payload = buildLogPayload(
      values([{ reps: "10", weight: "225", rpe: "", weightKg: null }]),
      "imperial",
      ALL_DIRTY,
    );
    expect(setsOf(payload)[0].weight).toBeCloseTo(225 * KG_PER_LB, 6);
  });

  it("stores a metric edit verbatim", () => {
    const payload = buildLogPayload(
      values([{ reps: "10", weight: "102.5", rpe: "", weightKg: null }]),
      "metric",
      ALL_DIRTY,
    );
    expect(setsOf(payload)[0].weight).toBe(102.5);
  });

  it("resubmits a wholly untouched log byte-identical", () => {
    // 100 kg seeds as "220.5" for an imperial client; re-parsing that string
    // would store 100.017 kg.
    const payload = buildLogPayload(
      values([{ reps: "10", weight: "220.5", rpe: "8", weightKg: 100 }]),
      "imperial",
      NOTHING_DIRTY,
    );
    expect(setsOf(payload)[0].weight).toBe(100);
  });

  // THE case. A row is dirty the moment its reps change, so a row-level guard
  // would let this drift — and the wholly-untouched test above would still pass.
  it("leaves an untouched WEIGHT alone when its row is dirty from a reps edit", () => {
    const dirtyRepsOnly = (_ex: number, _set: number) => false; // weight not dirty
    const payload = buildLogPayload(
      values([{ reps: "12", weight: "220.5", rpe: "8", weightKg: 100 }]),
      "imperial",
      dirtyRepsOnly,
    );

    expect(setsOf(payload)[0].reps).toBe(12);
    expect(setsOf(payload)[0].weight).toBe(100);
  });

  it("guards per set, not per exercise", () => {
    const onlySecondSetDirty = (_ex: number, setIndex: number) => setIndex === 1;
    const payload = buildLogPayload(
      values([
        { reps: "10", weight: "220.5", rpe: "", weightKg: 100 },
        { reps: "10", weight: "225", rpe: "", weightKg: 100 },
      ]),
      "imperial",
      onlySecondSetDirty,
    );

    expect(setsOf(payload)[0].weight).toBe(100);
    expect(setsOf(payload)[1].weight).toBeCloseTo(225 * KG_PER_LB, 6);
  });

  it("clears the weight when an edited field is emptied", () => {
    const payload = buildLogPayload(
      values([{ reps: "10", weight: "", rpe: "", weightKg: 100 }]),
      "imperial",
      ALL_DIRTY,
    );
    expect(setsOf(payload)[0].weight).toBeUndefined();
  });

  it("drops rows with nothing in them", () => {
    const payload = buildLogPayload(values([emptySet()]), "metric", ALL_DIRTY);
    expect(payload.exercises).toBeUndefined();
  });
});
