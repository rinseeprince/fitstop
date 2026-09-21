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
  it("returns no values, no sets and a zero set count for no sets", () => {
    const values = aggregateSessionMarkers([]);
    expect(values.actualSets).toBe(0);
    expect(values.sets).toEqual([]);
    for (const [key, value] of Object.entries(values)) {
      if (key !== "actualSets" && key !== "sets") expect(value, key).toBeNull();
    }
  });

  it("excludes warm-ups from every value, the sets and the set count", () => {
    const values = aggregateSessionMarkers([
      set({ setType: "warmup", reps: 10, weight: 200, durationSeconds: 999, distanceMeters: 5000, paceSecondsPerKm: 100, power: 999 }),
      set({ reps: 5, weight: 100 }),
    ]);
    expect(values.topSetWeight).toBe(100);
    expect(values.totalVolume).toBe(500);
    expect(values.totalReps).toBe(5);
    expect(values.averagePaceSecondsPerKm).toBeNull();
    expect(values.totalDurationSeconds).toBeNull();
    expect(values.totalDistanceMeters).toBeNull();
    expect(values.averagePower).toBeNull();
    expect(values.sets).toEqual([{ weight: 100, reps: 5, distanceMeters: null, durationSeconds: null }]);
    expect(values.actualSets).toBe(1);
  });

  it("lists the working sets in the order logged, as the shorthand reads them", () => {
    const values = aggregateSessionMarkers([
      set({ reps: 8, weight: 100, rpe: 7 }),
      set({ setType: "drop", reps: 12, weight: 70 }),
      set({ setType: "failure", reps: 6, weight: 100 }),
    ]);
    expect(values.sets).toEqual([
      { weight: 100, reps: 8, distanceMeters: null, durationSeconds: null },
      { weight: 70, reps: 12, distanceMeters: null, durationSeconds: null },
      { weight: 100, reps: 6, distanceMeters: null, durationSeconds: null },
    ]);
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

  it("takes best set reps from sets logged with no load only, and adds up every set's reps", () => {
    const values = aggregateSessionMarkers([
      set({ reps: 12 }),
      set({ reps: 20, weight: 10 }),
      set({ reps: 14 }),
    ]);
    expect(values.bestSetReps).toBe(14);
    expect(values.totalReps).toBe(46);
    expect(values.topSetWeight).toBe(10);
    expect(values.topSetReps).toBe(20);
  });

  it("reads an endurance session as a whole: its distance and time added up, the average pace over them", () => {
    // 6 × 800 m in 2:52, 2:50, 2:48, 2:55, 2:51, 2:53 — 4.8 km in 17:09
    const times = [172, 170, 168, 175, 171, 173];
    const values = aggregateSessionMarkers(
      times.map((durationSeconds) => set({ distanceMeters: 800, durationSeconds, paceSecondsPerKm: 200 })),
    );
    expect(values.totalDistanceMeters).toBe(4800);
    expect(values.totalDurationSeconds).toBe(1029);
    // 1029 s over 4.8 km, to the second — not the pace typed on any set
    expect(values.averagePaceSecondsPerKm).toBe(214);
    // A run logs no split, so it has none
    expect(values.averageSplitSecondsPer500m).toBeNull();
  });

  it("reads an erg session's average split the same way, and no pace", () => {
    // 1029 s over 9.6 × 500 m, to a tenth
    const values = aggregateSessionMarkers(
      [172, 170, 168, 175, 171, 173].map((durationSeconds) =>
        set({ distanceMeters: 800, durationSeconds, splitSecondsPer500m: 100 }),
      ),
    );
    expect(values.averageSplitSecondsPer500m).toBe(107.2);
    expect(values.averagePaceSecondsPerKm).toBeNull();
  });

  it("averages only over the sets that logged a distance and a time, and falls back on the paces typed", () => {
    const values = aggregateSessionMarkers([
      set({ distanceMeters: 5000, durationSeconds: 1450, paceSecondsPerKm: 291 }),
      set({ distanceMeters: 400 }),
    ]);
    expect(values.totalDistanceMeters).toBe(5400);
    expect(values.averagePaceSecondsPerKm).toBe(290);

    const typedOnly = aggregateSessionMarkers([
      set({ distanceMeters: 1000, paceSecondsPerKm: 300, splitSecondsPer500m: 120 }),
      set({ distanceMeters: 1000, paceSecondsPerKm: 281, splitSecondsPer500m: 112.5 }),
    ]);
    expect(typedOnly.averagePaceSecondsPerKm).toBe(291);
    expect(typedOnly.averageSplitSecondsPer500m).toBe(116.3);
    expect(aggregateSessionMarkers([set({ reps: 10 })]).averagePaceSecondsPerKm).toBeNull();
  });

  it("averages the stroke rate and watts, and takes the highest HR zone", () => {
    const values = aggregateSessionMarkers([
      set({ strokeRate: 26, power: 210, heartRateZone: 3 }),
      set({ strokeRate: 29, power: 245, heartRateZone: 4 }),
      set({ heartRateZone: 2 }),
    ]);
    expect(values.averageStrokeRate).toBe(28);
    expect(values.averagePower).toBe(228);
    expect(values.maxHeartRateZone).toBe(4);
  });

  it("takes the longest hold from sets with no distance, and adds up every set's time", () => {
    const values = aggregateSessionMarkers([
      set({ distanceMeters: 40, durationSeconds: 38, weight: 60 }),
      set({ durationSeconds: 90 }),
      set({ durationSeconds: 120 }),
    ]);
    expect(values.longestHoldSeconds).toBe(120);
    expect(values.totalDurationSeconds).toBe(248);
  });

  it("rounds the estimated 1RM to a tenth", () => {
    const values = aggregateSessionMarkers([set({ reps: 7, weight: 100 })]);
    expect(values.estimatedOneRepMax).toBe(123.3);
  });
});

describe("RPE", () => {
  it("reads the top set's, even when it recorded none", () => {
    const values = aggregateSessionMarkers([
      set({ reps: 8, weight: 80, rpe: 7 }),
      set({ reps: 5, weight: 100, rpe: 8.5 }),
    ]);
    expect(values.rpe).toBe(8.5);

    // The heaviest set logged no effort: the lighter set's RPE does not stand in
    const silentTop = aggregateSessionMarkers([
      set({ reps: 8, weight: 80, rpe: 9 }),
      set({ reps: 5, weight: 100 }),
    ]);
    expect(silentTop.rpe).toBeNull();
  });

  it("takes the highest logged in a session with no loaded set", () => {
    const run = aggregateSessionMarkers([
      set({ distanceMeters: 1000, durationSeconds: 240, rpe: 6 }),
      set({ distanceMeters: 1000, durationSeconds: 236, rpe: 8 }),
      set({ distanceMeters: 1000, durationSeconds: 250, rpe: 7 }),
    ]);
    expect(run.rpe).toBe(8);

    // A plank and a bodyweight set likewise; a typed 0 kg is no load
    expect(aggregateSessionMarkers([set({ durationSeconds: 90, rpe: 7 }), set({ durationSeconds: 60, rpe: 9 })]).rpe).toBe(9);
    expect(aggregateSessionMarkers([set({ reps: 12, weight: 0, rpe: 6 }), set({ reps: 10, rpe: 8 })]).rpe).toBe(8);
  });

  it("counts no warm-up", () => {
    const values = aggregateSessionMarkers([
      set({ setType: "warmup", rpe: 10, strokeRate: 60, heartRateZone: 5, power: 999 }),
      set({ durationSeconds: 60, rpe: 6, strokeRate: 20, heartRateZone: 2, power: 150 }),
    ]);
    expect(values).toMatchObject({ rpe: 6, averageStrokeRate: 20, maxHeartRateZone: 2, averagePower: 150 });
  });
});
