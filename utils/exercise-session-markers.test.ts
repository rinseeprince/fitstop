import { describe, expect, it } from "vitest";
import {
  aggregateSessionMarkers,
  hasLoad,
  isBodyweightSet,
  isHold,
  isLift,
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

  it("reads reps on a distance or a time as repeats, never a bodyweight set (owner, 2026-09-21)", () => {
    // 3 reps of 1 km is 3 km, 3 reps of 30 s is 1:30
    expect(isBodyweightSet(set({ reps: 3, distanceMeters: 1000, paceSecondsPerKm: 270 }))).toBe(false);
    expect(isBodyweightSet(set({ reps: 3, durationSeconds: 30 }))).toBe(false);
    expect(isBodyweightSet(set({ reps: 3, distanceMeters: 40, weight: 0 }))).toBe(false);
  });

  it("reads a load with neither a distance nor a time as a lift", () => {
    expect(isLift(set({ weight: 100, reps: 5 }))).toBe(true);
    expect(isLift(set({ weight: 100 }))).toBe(true);
    // Carried, held for time, or no load at all: not a lift
    expect(isLift(set({ weight: 64, reps: 3, distanceMeters: 40 }))).toBe(false);
    expect(isLift(set({ weight: 64, reps: 3, durationSeconds: 30 }))).toBe(false);
    expect(isLift(set({ weight: 100, reps: 8, durationSeconds: 40 }))).toBe(false);
    expect(isLift(set({ weight: 0, reps: 5 }))).toBe(false);
    expect(isLift(set({ reps: 5 }))).toBe(false);
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
    // The top set is the heaviest load of any set — the carry's, here
    expect(values.topSetWeight).toBe(100);
    expect(values.topSetReps).toBe(6);
    expect(values.rpe).toBe(9);
    expect(values.topSetDistanceMeters).toBe(40);
    expect(values.topSetDurationSeconds).toBe(35);
    // The volume and the e1RM are the lifts': the carry's 6 are repeats of 40 m, not reps
    expect(values.totalVolume).toBe(8 * 80 + 5 * 100 + 12 * 60);
    // Epley on the best lift: 100 * (1 + 5/30) = 116.7
    expect(values.estimatedOneRepMax).toBe(116.7);
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

  it("reads an endurance session as a whole: its distance and time added up, the average rate over them", () => {
    // 6 × 800 m in 2:52, 2:50, 2:48, 2:55, 2:51, 2:53 — 4.8 km in 17:09
    const times = [172, 170, 168, 175, 171, 173];
    const values = aggregateSessionMarkers(
      times.map((durationSeconds) => set({ distanceMeters: 800, durationSeconds, paceSecondsPerKm: 200 })),
    );
    expect(values.totalDistanceMeters).toBe(4800);
    expect(values.totalDurationSeconds).toBe(1029);
    // 1029 s over 4.8 km, to the second — not the pace typed on any set
    expect(values.averagePaceSecondsPerKm).toBe(214);
    // The same rate per 500 m, to a tenth: the chart offers each type one of the two
    expect(values.averageSplitSecondsPer500m).toBe(107.2);
  });

  it("counts reps on a set with a distance or a time as repeats (owner, 2026-09-21)", () => {
    // 3 × 1 km, 3 × 800 m, 3 × 600 m, 3 × 400 m at the paces typed, no time typed
    const values = aggregateSessionMarkers([
      set({ reps: 3, distanceMeters: 1000, paceSecondsPerKm: 270 }),
      set({ reps: 3, distanceMeters: 800, paceSecondsPerKm: 255 }),
      set({ reps: 3, distanceMeters: 600, paceSecondsPerKm: 240 }),
      set({ reps: 3, distanceMeters: 400, paceSecondsPerKm: 225 }),
    ]);
    expect(values.totalDistanceMeters).toBe(8400);
    // Each set's time from its pace over its distance, once per rep: 3 × (4:30 + 3:24 + 2:24 + 1:30)
    expect(values.totalDurationSeconds).toBe(2124);
    // 35:24 over 8.4 km — every metre counted, not the four paces' plain mean (4:08)
    expect(values.averagePaceSecondsPerKm).toBe(253);

    // A typed time is per rep too, and a hold's reps are repeats of its time
    const intervals = aggregateSessionMarkers([set({ reps: 5, distanceMeters: 500, durationSeconds: 110 })]);
    expect(intervals.totalDistanceMeters).toBe(2500);
    expect(intervals.totalDurationSeconds).toBe(550);
    expect(intervals.averageSplitSecondsPer500m).toBe(110);
    const holds = aggregateSessionMarkers([set({ reps: 3, durationSeconds: 30 })]);
    expect(holds.totalDurationSeconds).toBe(90);
    expect(holds.longestHoldSeconds).toBe(30);
    // A lift's reps stay its reps: nothing to multiply
    expect(aggregateSessionMarkers([set({ reps: 5, weight: 100 })]).totalDurationSeconds).toBeNull();
  });

  it("never reads repeats as reps: no best set, no rep total, no e1RM and no volume from them (owner, 2026-09-21)", () => {
    // The owner's run: 3 × 1 km, 3 × 800 m, 3 × 600 m, 3 × 400 m
    const run = aggregateSessionMarkers([
      set({ reps: 3, distanceMeters: 1000, paceSecondsPerKm: 270 }),
      set({ reps: 3, distanceMeters: 800, paceSecondsPerKm: 255 }),
      set({ reps: 3, distanceMeters: 600, paceSecondsPerKm: 240 }),
      set({ reps: 3, distanceMeters: 400, paceSecondsPerKm: 225 }),
    ]);
    expect(run.bestSetReps).toBeNull();
    expect(run.totalReps).toBeNull();

    // A carry of 3 × 40 m at 64 kg: its Load is the heaviest carry, and its 3 are repeats
    const carry = aggregateSessionMarkers([set({ reps: 3, distanceMeters: 40, weight: 64 })]);
    expect(carry.topSetWeight).toBe(64);
    expect(carry.totalDistanceMeters).toBe(120);
    expect(carry.estimatedOneRepMax).toBeNull();
    expect(carry.totalVolume).toBeNull();
    expect(carry.totalReps).toBeNull();

    // Timed repeats, with a load or without: the same
    const timed = aggregateSessionMarkers([
      set({ reps: 3, durationSeconds: 30, weight: 64 }),
      set({ reps: 3, durationSeconds: 30 }),
    ]);
    expect(timed.estimatedOneRepMax).toBeNull();
    expect(timed.totalVolume).toBeNull();
    expect(timed.bestSetReps).toBeNull();
    expect(timed.totalReps).toBeNull();
    expect(timed.totalDurationSeconds).toBe(180);
  });

  it("leaves pull-ups and lifts as they were beside repeats in the same session", () => {
    const values = aggregateSessionMarkers([
      set({ reps: 12 }),
      set({ reps: 5, weight: 100 }),
      set({ reps: 20, distanceMeters: 40 }),
    ]);
    expect(values.bestSetReps).toBe(12);
    expect(values.totalReps).toBe(17);
    expect(values.estimatedOneRepMax).toBe(116.7);
    expect(values.totalVolume).toBe(500);
  });

  it("uses the time typed over the pace typed, and a split over its distance where no pace was", () => {
    const both = aggregateSessionMarkers([set({ distanceMeters: 5000, durationSeconds: 1450, paceSecondsPerKm: 300 })]);
    expect(both.totalDurationSeconds).toBe(1450);
    expect(both.averagePaceSecondsPerKm).toBe(290);

    const erg = aggregateSessionMarkers([
      set({ distanceMeters: 2000, splitSecondsPer500m: 120 }),
      set({ distanceMeters: 1000, splitSecondsPer500m: 114 }),
    ]);
    // 8:00 + 3:48 over 3 km
    expect(erg.totalDurationSeconds).toBe(708);
    expect(erg.averageSplitSecondsPer500m).toBe(118);
  });

  it("falls back on the rates typed, once per rep, where no set has a distance with a time", () => {
    const values = aggregateSessionMarkers([
      set({ durationSeconds: 1200, paceSecondsPerKm: 300 }),
      set({ reps: 3, durationSeconds: 60, paceSecondsPerKm: 240 }),
    ]);
    // (300 + 3 × 240) / 4
    expect(values.averagePaceSecondsPerKm).toBe(255);
    expect(values.totalDurationSeconds).toBe(1380);
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
