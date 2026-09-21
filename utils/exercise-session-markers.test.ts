import { describe, expect, it } from "vitest";
import {
  aggregateSessionMarkers,
  hasLoad,
  isBodyweightSet,
  isHold,
  isTimedDistance,
  type MarkerSet,
} from "./exercise-session-markers";
import { emptyLoggedActuals } from "./set-log-measures";

/** A working set recording nothing but what the case sets — every measure a set can carry. */
function set(overrides: Partial<MarkerSet> = {}): MarkerSet {
  const { tempo: _tempo, ...measures } = emptyLoggedActuals();
  return { setType: "working", ...measures, ...overrides };
}

describe("the set shapes", () => {
  it("reads a load as a weight above zero", () => {
    expect(hasLoad(set({ weight: 20 }))).toBe(true);
    expect(hasLoad(set({ weight: 0 }))).toBe(false);
    expect(hasLoad(set())).toBe(false);
  });

  it("reads reps with no load as a bodyweight set", () => {
    expect(isBodyweightSet(set({ reps: 10 }))).toBe(true);
    expect(isBodyweightSet(set({ reps: 10, weight: 0 }))).toBe(true);
    expect(isBodyweightSet(set({ reps: 10, weight: 20 }))).toBe(false);
    expect(isBodyweightSet(set({ weight: 20 }))).toBe(false);
  });

  it("reads a time with a distance as a timed distance and a time without one as a hold", () => {
    expect(isTimedDistance(set({ durationSeconds: 222, distanceMeters: 1000 }))).toBe(true);
    expect(isHold(set({ durationSeconds: 222, distanceMeters: 1000 }))).toBe(false);
    expect(isHold(set({ durationSeconds: 90 }))).toBe(true);
    expect(isTimedDistance(set({ durationSeconds: 90 }))).toBe(false);
    expect(isHold(set({ durationSeconds: 90, weight: 20 }))).toBe(true);
  });
});

describe("aggregateSessionMarkers", () => {
  it("returns nothing but a zero set count for no sets", () => {
    const values = aggregateSessionMarkers([]);
    expect(values.actualSets).toBe(0);
    for (const [key, value] of Object.entries(values)) {
      if (key !== "actualSets") expect(value, key).toBeNull();
    }
  });

  it("excludes warm-ups from every marker and from the set count", () => {
    const values = aggregateSessionMarkers([
      set({ setType: "warmup", reps: 10, weight: 200, durationSeconds: 999, distanceMeters: 5000, paceSecondsPerKm: 100, power: 999 }),
      set({ reps: 5, weight: 100 }),
    ]);
    expect(values.topSetWeight).toBe(100);
    expect(values.totalVolume).toBe(500);
    expect(values.bestPaceSecondsPerKm).toBeNull();
    expect(values.bestTimeSeconds).toBeNull();
    expect(values.totalDistanceMeters).toBeNull();
    expect(values.bestPower).toBeNull();
    expect(values.actualSets).toBe(1);
  });

  it("takes the heaviest set as the top set, tiebreaking on reps, with what else it recorded", () => {
    const values = aggregateSessionMarkers([
      set({ reps: 8, weight: 80, rpe: 7 }),
      set({ reps: 5, weight: 100, rpe: 8 }),
      set({ reps: 6, weight: 100, rpe: 9, distanceMeters: 40, durationSeconds: 35 }),
      set({ setType: "failure", reps: 12, weight: 60 }),
    ]);
    expect(values.topSetWeight).toBe(100);
    expect(values.topSetReps).toBe(6);
    expect(values.rpe).toBe(9);
    expect(values.topSetDistanceMeters).toBe(40);
    expect(values.topSetDurationSeconds).toBe(35);
    expect(values.totalVolume).toBe(8 * 80 + 5 * 100 + 6 * 100 + 12 * 60);
    // Epley on the best set: 100 * (1 + 6/30) = 120
    expect(values.estimatedOneRepMax).toBe(120);
  });

  it("counts a 0 kg set as no load: not a top set, not volume, but a bodyweight set", () => {
    const values = aggregateSessionMarkers([set({ reps: 15, weight: 0 })]);
    expect(values.topSetWeight).toBeNull();
    expect(values.totalVolume).toBeNull();
    expect(values.estimatedOneRepMax).toBeNull();
    expect(values.bestSetReps).toBe(15);
  });

  it("takes best set reps from sets logged with no load only", () => {
    const values = aggregateSessionMarkers([
      set({ reps: 12 }),
      set({ reps: 20, weight: 10 }),
      set({ reps: 14 }),
    ]);
    expect(values.bestSetReps).toBe(14);
    expect(values.topSetWeight).toBe(10);
    expect(values.topSetReps).toBe(20);
  });

  it("takes the fastest pace and split, the highest watts, and sums the distance", () => {
    const values = aggregateSessionMarkers([
      set({ distanceMeters: 1000, paceSecondsPerKm: 300, splitSecondsPer500m: 120, power: 180 }),
      set({ distanceMeters: 2000, paceSecondsPerKm: 280, splitSecondsPer500m: 112.5, power: 210 }),
      set({ distanceMeters: 500, paceSecondsPerKm: 310, splitSecondsPer500m: 118, power: 195 }),
    ]);
    expect(values.bestPaceSecondsPerKm).toBe(280);
    expect(values.bestPaceDistanceMeters).toBe(2000);
    expect(values.bestSplitSecondsPer500m).toBe(112.5);
    expect(values.bestSplitDistanceMeters).toBe(2000);
    expect(values.bestPower).toBe(210);
    expect(values.totalDistanceMeters).toBe(3500);
  });

  it("takes the fastest timed distance with its distance and load, and the longest hold from sets with no distance", () => {
    const values = aggregateSessionMarkers([
      set({ distanceMeters: 40, durationSeconds: 38, weight: 60 }),
      set({ distanceMeters: 40, durationSeconds: 35, weight: 64 }),
      set({ durationSeconds: 90 }),
      set({ durationSeconds: 120 }),
    ]);
    expect(values.bestTimeSeconds).toBe(35);
    expect(values.bestTimeDistanceMeters).toBe(40);
    expect(values.bestTimeWeight).toBe(64);
    expect(values.longestHoldSeconds).toBe(120);
  });

  it("carries no load on a timed distance logged without one", () => {
    const values = aggregateSessionMarkers([set({ distanceMeters: 5000, durationSeconds: 1500 })]);
    expect(values.bestTimeSeconds).toBe(1500);
    expect(values.bestTimeWeight).toBeNull();
    expect(values.longestHoldSeconds).toBeNull();
  });

  it("rounds the estimated 1RM to a tenth", () => {
    const values = aggregateSessionMarkers([set({ reps: 7, weight: 100 })]);
    expect(values.estimatedOneRepMax).toBe(123.3);
  });
});

describe("the Sessions table's values", () => {
  it("reads RPE and RIR off the top set, even when it recorded none", () => {
    const values = aggregateSessionMarkers([
      set({ reps: 8, weight: 80, rpe: 7, rir: 3 }),
      set({ reps: 5, weight: 100, rpe: 8.5, rir: 1 }),
    ]);
    expect(values.rpe).toBe(8.5);
    expect(values.rir).toBe(1);

    // The heaviest set logged no effort: the lighter set's RPE does not stand in
    const silentTop = aggregateSessionMarkers([
      set({ reps: 8, weight: 80, rpe: 9, rir: 1 }),
      set({ reps: 5, weight: 100 }),
    ]);
    expect(silentTop.rpe).toBeNull();
    expect(silentTop.rir).toBeNull();
  });

  it("takes the highest RPE and the lowest RIR logged in a session with no loaded set", () => {
    const run = aggregateSessionMarkers([
      set({ distanceMeters: 1000, durationSeconds: 240, rpe: 6, rir: 4 }),
      set({ distanceMeters: 1000, durationSeconds: 236, rpe: 8, rir: 2 }),
      set({ distanceMeters: 1000, durationSeconds: 250, rpe: 7 }),
    ]);
    expect(run.rpe).toBe(8);
    expect(run.rir).toBe(2);

    // A plank and a bodyweight set likewise; a typed 0 kg is no load
    expect(aggregateSessionMarkers([set({ durationSeconds: 90, rpe: 7 }), set({ durationSeconds: 60, rpe: 9 })]).rpe).toBe(9);
    expect(aggregateSessionMarkers([set({ reps: 12, weight: 0, rpe: 6 }), set({ reps: 10, rpe: 8 })]).rpe).toBe(8);
  });

  it("adds up the calories and takes the highest of each machine and body reading", () => {
    const values = aggregateSessionMarkers([
      set({ calories: 120, cadence: 88, strokeRate: 26, resistance: 5, heartRateZone: 2, heartRate: 148, ftpPercent: 75 }),
      set({ calories: 180, cadence: 95, strokeRate: 24, resistance: 6.5, heartRateZone: 4, heartRate: 171, ftpPercent: 92.5 }),
      set({ cadence: 91 }),
    ]);
    expect(values.totalCalories).toBe(300);
    expect(values.maxCadence).toBe(95);
    expect(values.maxStrokeRate).toBe(26);
    expect(values.maxResistance).toBe(6.5);
    expect(values.maxHeartRateZone).toBe(4);
    expect(values.maxHeartRate).toBe(171);
    expect(values.maxFtpPercent).toBe(92.5);
  });

  it("averages the rest taken over the sets that recorded one, to the second", () => {
    const values = aggregateSessionMarkers([
      set({ reps: 5, weight: 100, restSeconds: 90 }),
      set({ reps: 5, weight: 100, restSeconds: 121 }),
      set({ reps: 5, weight: 100 }),
    ]);
    expect(values.averageRestSeconds).toBe(106);
  });

  it("counts no warm-up toward any of them", () => {
    const values = aggregateSessionMarkers([
      set({ setType: "warmup", rpe: 10, rir: 0, calories: 500, cadence: 200, strokeRate: 60, resistance: 10, heartRateZone: 5, heartRate: 200, ftpPercent: 150, restSeconds: 600 }),
      set({ durationSeconds: 60, rpe: 6, rir: 3, calories: 50, cadence: 80, strokeRate: 20, resistance: 3, heartRateZone: 2, heartRate: 130, ftpPercent: 60, restSeconds: 60 }),
    ]);
    expect(values).toMatchObject({
      rpe: 6,
      rir: 3,
      totalCalories: 50,
      maxCadence: 80,
      maxStrokeRate: 20,
      maxResistance: 3,
      maxHeartRateZone: 2,
      maxHeartRate: 130,
      maxFtpPercent: 60,
      averageRestSeconds: 60,
    });
  });
});
