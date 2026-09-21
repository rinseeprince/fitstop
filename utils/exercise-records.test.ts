import { describe, expect, it } from "vitest";
import type { ExerciseBest, ExercisePR, ExerciseSessionSet } from "@/types/training";
import { describeRecord, recordLine, recordsHeldBy } from "./exercise-records";

const DAY = "2026-08-12T00:00:00+00:00";

const set = (overrides: Partial<ExerciseSessionSet>): ExerciseSessionSet => ({
  weight: null,
  reps: null,
  distanceMeters: null,
  durationSeconds: null,
  ...overrides,
});

const record = (best: ExerciseBest, date = DAY): ExercisePR => ({ ...best, date, isRecent: false });

describe("a record's words", () => {
  it("reads as its PR card reads, in the viewer's units", () => {
    expect(recordLine(record({ kind: "rep_max", reps: 8, weight: 102.5 }), "metric")).toBe("8 Rep Max · 102.5 kg");
    expect(recordLine(record({ kind: "rep_max", reps: 1, weight: 110 }), "imperial")).toBe("1 Rep Max · 242.5 lbs");
    expect(recordLine(record({ kind: "best_reps", reps: 12 }), "metric")).toBe("Best set · 12 reps");
    expect(recordLine(record({ kind: "best_time", distanceMeters: 5000, durationSeconds: 1450 }), "metric")).toBe(
      "5 km · 24:10",
    );
    expect(recordLine(record({ kind: "heaviest_carry", distanceMeters: 40, weight: 64 }), "metric")).toBe(
      "40 m carry · 64 kg",
    );
    expect(recordLine(record({ kind: "longest_hold", durationSeconds: 90 }), "metric")).toBe("Longest hold · 1:30");
    expect(describeRecord({ kind: "best_time", distanceMeters: 5000, durationSeconds: 1450 }, "metric").numericLabel).toBe(true);
  });
});

describe("the records a session holds", () => {
  it("are those set on its day by one of its sets, on each kind's own rule", () => {
    const records = [
      record({ kind: "rep_max", reps: 1, weight: 110 }),
      record({ kind: "rep_max", reps: 8, weight: 102.5 }),
      record({ kind: "best_reps", reps: 12 }),
      record({ kind: "best_time", distanceMeters: 800, durationSeconds: 168 }),
      record({ kind: "heaviest_carry", distanceMeters: 40, weight: 64 }),
      record({ kind: "longest_hold", durationSeconds: 90 }),
    ];
    const held = (sets: ExerciseSessionSet[]) =>
      recordsHeldBy({ date: DAY, sets }, records).map((r) => `${r.kind}`);

    expect(held([set({ weight: 110, reps: 1 }), set({ weight: 100, reps: 5 })])).toEqual(["rep_max"]);
    expect(held([set({ reps: 12 })])).toEqual(["best_reps"]);
    // Twelve reps with a load is not the bodyweight record
    expect(held([set({ reps: 12, weight: 20 })])).toEqual([]);
    expect(held([set({ distanceMeters: 800, durationSeconds: 170 }), set({ distanceMeters: 800, durationSeconds: 168 })])).toEqual([
      "best_time",
    ]);
    expect(held([set({ distanceMeters: 40, weight: 64, durationSeconds: 35 })])).toEqual(["heaviest_carry"]);
    expect(held([set({ durationSeconds: 90 })])).toEqual(["longest_hold"]);
    // A timed distance of the same length is not a hold
    expect(held([set({ durationSeconds: 90, distanceMeters: 200 })])).toEqual([]);
  });

  it("are never held by repeats: reps on a distance or a time are not reps (owner, 2026-09-21)", () => {
    // Two sessions on one day: the lift and the bodyweight set hold the records,
    // a carry's and a run's repeats of the same numbers hold nothing
    const records = [record({ kind: "rep_max", reps: 3, weight: 64 }), record({ kind: "best_reps", reps: 3 })];
    const held = (sets: ExerciseSessionSet[]) =>
      recordsHeldBy({ date: DAY, sets }, records).map((r) => `${r.kind}`);

    expect(held([set({ weight: 64, reps: 3 })])).toEqual(["rep_max"]);
    expect(held([set({ reps: 3 })])).toEqual(["best_reps"]);
    expect(held([set({ weight: 64, reps: 3, distanceMeters: 40 })])).toEqual([]);
    expect(held([set({ weight: 64, reps: 3, durationSeconds: 30 })])).toEqual([]);
    expect(held([set({ reps: 3, distanceMeters: 1000 })])).toEqual([]);
    expect(held([set({ reps: 3, durationSeconds: 30 })])).toEqual([]);
  });

  it("belong to the day they were set: the same set on another day holds nothing", () => {
    const records = [record({ kind: "rep_max", reps: 1, weight: 110 })];
    expect(recordsHeldBy({ date: "2026-08-19T00:00:00+00:00", sets: [set({ weight: 110, reps: 1 })] }, records)).toEqual([]);
    expect(recordsHeldBy({ date: DAY, sets: [set({ weight: 110, reps: 1 })] }, records)).toHaveLength(1);
  });
});
