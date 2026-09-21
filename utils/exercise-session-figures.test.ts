import { describe, expect, it } from "vitest";
import type { ExerciseProgressionPoint, ExerciseSessionSet } from "@/types/training";
import { EXERCISE_TYPES } from "./exercise-types";
import { PROGRESS_MARKER_SPECS } from "./exercise-progress-markers";
import {
  DEFAULT_SESSION_SORT,
  EXERCISE_TYPE_FIGURES,
  SESSION_FIGURE_SPECS,
  SESSION_FIGURES,
  formatSessionFigure,
  formatSessionSets,
  nextSessionSort,
  sessionFigureHeading,
  sessionSetsHeading,
  sessionSortLabel,
  sortSessions,
} from "./exercise-session-figures";

function point(overrides: Partial<ExerciseProgressionPoint> = {}): ExerciseProgressionPoint {
  return {
    date: "2026-09-04T00:00:00+00:00",
    sessionLogId: "sl-1",
    eventId: null,
    sets: [],
    topSetWeight: null,
    topSetReps: null,
    topSetDistanceMeters: null,
    topSetDurationSeconds: null,
    rpe: null,
    estimatedOneRepMax: null,
    totalVolume: null,
    bestSetReps: null,
    totalReps: null,
    totalDistanceMeters: null,
    totalDurationSeconds: null,
    averagePaceSecondsPerKm: null,
    averageSplitSecondsPer500m: null,
    averageStrokeRate: null,
    averagePower: null,
    maxHeartRateZone: null,
    longestHoldSeconds: null,
    prescribedSets: null,
    actualSets: 0,
    prescribedRepsMin: null,
    prescribedRepsMax: null,
    ...overrides,
  };
}

const set = (overrides: Partial<ExerciseSessionSet>): ExerciseSessionSet => ({
  weight: null,
  reps: null,
  distanceMeters: null,
  durationSeconds: null,
  ...overrides,
});

describe("each type's figures", () => {
  it("names a fixed few for every type, the main one first", () => {
    expect(Object.keys(EXERCISE_TYPE_FIGURES).sort()).toEqual([...EXERCISE_TYPES].sort());
    expect(EXERCISE_TYPE_FIGURES).toEqual({
      strength: ["e1rm", "top_set", "volume", "rpe"],
      bodyweight: ["best_set", "total_reps", "rpe"],
      endurance: ["pace", "distance", "time", "hr_zone"],
      erg: ["split", "distance", "time", "stroke_rate", "watts"],
      carry_sled: ["load", "distance", "time"],
      holds: ["longest_hold", "total_time", "rpe"],
    });
  });

  it("reads the key the chart plots wherever the chart plots the same figure, so a point and its row match", () => {
    const twin = {
      e1rm: "e1rm",
      top_set: "weight",
      volume: "volume",
      rpe: "rpe",
      best_set: "reps",
      pace: "pace",
      distance: "distance",
      time: "time",
      split: "split",
      watts: "power",
      load: "weight",
      longest_hold: "hold",
      total_time: "time",
    } as const;
    for (const [figure, marker] of Object.entries(twin)) {
      expect(SESSION_FIGURE_SPECS[figure as keyof typeof twin].value, figure).toBe(
        PROGRESS_MARKER_SPECS[marker].value,
      );
    }
    expect(SESSION_FIGURES).toHaveLength(Object.keys(SESSION_FIGURE_SPECS).length);
  });
});

describe("a figure's cell", () => {
  it("reads each figure in the viewer's units, the top set with its reps", () => {
    const p = point({
      estimatedOneRepMax: 129.8,
      topSetWeight: 102.5,
      topSetReps: 8,
      totalVolume: 2460,
      rpe: 8.5,
      averagePaceSecondsPerKm: 290,
      totalDistanceMeters: 5000,
      totalDurationSeconds: 1450,
      maxHeartRateZone: 3,
      averageSplitSecondsPer500m: 112.3,
      averageStrokeRate: 28,
      averagePower: 245,
      longestHoldSeconds: 90,
    });
    expect(formatSessionFigure("e1rm", p, "metric")).toBe("129.8");
    expect(formatSessionFigure("top_set", p, "metric")).toBe("102.5 × 8");
    expect(formatSessionFigure("volume", p, "metric")).toBe("2,460");
    expect(formatSessionFigure("rpe", p, "metric")).toBe("8.5");
    expect(formatSessionFigure("pace", p, "metric")).toBe("4:50 /km");
    expect(formatSessionFigure("distance", p, "metric")).toBe("5 km");
    expect(formatSessionFigure("time", p, "metric")).toBe("24:10");
    expect(formatSessionFigure("hr_zone", p, "metric")).toBe("Z3");
    expect(formatSessionFigure("split", p, "metric")).toBe("1:52.3 /500m");
    expect(formatSessionFigure("stroke_rate", p, "metric")).toBe("28");
    expect(formatSessionFigure("watts", p, "metric")).toBe("245");
    expect(formatSessionFigure("longest_hold", p, "metric")).toBe("1:30");
    expect(formatSessionFigure("top_set", point({ topSetWeight: 60 }), "metric")).toBe("60");
    expect(formatSessionFigure("pace", p, "imperial")).toBe("7:47 /mi");
    expect(formatSessionFigure("load", p, "imperial")).toBe("225");
  });

  it("is blank where the session has no value", () => {
    expect(formatSessionFigure("e1rm", point(), "metric")).toBeNull();
    expect(formatSessionFigure("pace", point(), "metric")).toBeNull();
  });

  it("heads a load's column with the viewer's unit", () => {
    expect(sessionFigureHeading("e1rm", "metric")).toBe("e1RM (kg)");
    expect(sessionFigureHeading("top_set", "imperial")).toBe("Top set (lbs)");
    expect(sessionFigureHeading("pace", "metric")).toBe("Pace");
  });
});

describe("the sets in shorthand", () => {
  it("reads loaded reps, reps alone, a carry and holds", () => {
    expect(
      formatSessionSets([set({ weight: 100, reps: 8 }), set({ weight: 102.5, reps: 8 }), set({ weight: 105, reps: 6 })], "metric"),
    ).toBe("100 × 8 · 102.5 × 8 · 105 × 6");
    expect(formatSessionSets([set({ reps: 12 }), set({ reps: 11 }), set({ reps: 10, weight: 0 })], "metric")).toBe("12 · 11 · 10");
    expect(formatSessionSets([set({ weight: 60, distanceMeters: 40, durationSeconds: 38 })], "metric")).toBe("60 × 40 m");
    expect(formatSessionSets([set({ durationSeconds: 90 }), set({ durationSeconds: 80 })], "metric")).toBe("1:30 · 1:20");
  });

  it("reads a session of one piece as its distance alone, a piece among others with its time, and repeats of one distance as one", () => {
    // The time of a one-piece session is its Time figure (owner, 2026-09-21)
    expect(formatSessionSets([set({ distanceMeters: 5000, durationSeconds: 1450 })], "metric")).toBe("5 km");
    expect(
      formatSessionSets([172, 170, 168].map((durationSeconds) => set({ distanceMeters: 800, durationSeconds })), "metric"),
    ).toBe("3 × 800 m: 2:52 · 2:50 · 2:48");
    expect(
      formatSessionSets(
        [
          set({ distanceMeters: 10000, durationSeconds: 3120 }),
          set({ distanceMeters: 100, durationSeconds: 20 }),
          set({ distanceMeters: 100, durationSeconds: 19 }),
        ],
        "metric",
      ),
    ).toBe("10 km in 52:00 · 2 × 100 m: 0:20 · 0:19");
    expect(formatSessionSets([set({ distanceMeters: 400 }), set({ distanceMeters: 400 })], "metric")).toBe("2 × 400 m");
  });

  it("reads reps on a distance or a time as repeats (owner, 2026-09-21)", () => {
    expect(
      formatSessionSets([1000, 800, 600, 400].map((distanceMeters) => set({ reps: 3, distanceMeters })), "metric"),
    ).toBe("3 × 1 km · 3 × 800 m · 3 × 600 m · 3 × 400 m");
    // One set of repeats reads its repeats, even alone
    expect(formatSessionSets([set({ reps: 5, distanceMeters: 500, durationSeconds: 110 })], "metric")).toBe("5 × 500 m");
    expect(formatSessionSets([set({ weight: 64, reps: 3, distanceMeters: 40 })], "metric")).toBe("64 × 3 × 40 m");
    expect(formatSessionSets([set({ reps: 3, durationSeconds: 30 })], "metric")).toBe("3 × 0:30");
    // A lift's reps stay its reps, whatever time it logged; one rep is one piece
    expect(formatSessionSets([set({ weight: 100, reps: 5, durationSeconds: 40 })], "metric")).toBe("100 × 5");
    expect(formatSessionSets([set({ weight: 64, reps: 3 })], "metric")).toBe("64 × 3");
    expect(
      formatSessionSets(
        [set({ reps: 1, distanceMeters: 800, durationSeconds: 170 }), set({ reps: 1, distanceMeters: 800, durationSeconds: 168 })],
        "metric",
      ),
    ).toBe("2 × 800 m: 2:50 · 2:48");
  });

  it("leaves out a set that logged none of load, reps, distance or time, and says nothing when none did", () => {
    expect(formatSessionSets([set({}), set({ weight: 100, reps: 5 })], "metric")).toBe("100 × 5");
    expect(formatSessionSets([set({}), set({})], "metric")).toBe("");
    expect(formatSessionSets([set({ weight: 20 })], "metric")).toBe("20");
  });

  it("reads loads and distances in the viewer's units", () => {
    expect(formatSessionSets([set({ weight: 100, reps: 5 })], "imperial")).toBe("220 × 5");
    expect(formatSessionSets([set({ distanceMeters: 1609.344, durationSeconds: 480 })], "imperial")).toBe("1 mi");
    expect(
      formatSessionSets([set({ distanceMeters: 1609.344, durationSeconds: 480 }), set({ distanceMeters: 400, durationSeconds: 75 })], "imperial"),
    ).toBe("1 mi in 8:00 · 437 yd in 1:15");
  });

  it("names the load's unit in the heading only when the window's sets carry one", () => {
    expect(sessionSetsHeading([point({ sets: [set({ weight: 100, reps: 5 })] })], "metric")).toBe("Sets (kg)");
    expect(sessionSetsHeading([point({ sets: [set({ reps: 12 })] })], "imperial")).toBe("Sets");
  });
});

describe("the sort", () => {
  it("names each sort in words", () => {
    expect(sessionSortLabel(DEFAULT_SESSION_SORT)).toBe("Newest first");
    expect(sessionSortLabel({ column: "date", order: "asc" })).toBe("Oldest first");
    expect(sessionSortLabel({ column: "e1rm", order: "desc" })).toBe("Highest e1RM first");
    expect(sessionSortLabel({ column: "pace", order: "asc" })).toBe("Fastest pace first");
    expect(sessionSortLabel({ column: "best_set", order: "desc" })).toBe("Most reps in a set first");
  });

  it("sorts a heading's figure the way it leads, and the other way on a second click", () => {
    expect(nextSessionSort(DEFAULT_SESSION_SORT, "e1rm")).toEqual({ column: "e1rm", order: "desc" });
    expect(nextSessionSort(DEFAULT_SESSION_SORT, "pace")).toEqual({ column: "pace", order: "asc" });
    expect(nextSessionSort({ column: "pace", order: "asc" }, "pace")).toEqual({ column: "pace", order: "desc" });
    expect(nextSessionSort({ column: "pace", order: "asc" }, "date")).toEqual(DEFAULT_SESSION_SORT);
    expect(nextSessionSort(DEFAULT_SESSION_SORT, "date")).toEqual({ column: "date", order: "asc" });
  });

  it("puts a session with no value last, ties newest first", () => {
    const a = point({ sessionLogId: "a", date: "2026-08-01T00:00:00+00:00", estimatedOneRepMax: 120 });
    const b = point({ sessionLogId: "b", date: "2026-08-08T00:00:00+00:00", estimatedOneRepMax: null });
    const c = point({ sessionLogId: "c", date: "2026-08-15T00:00:00+00:00", estimatedOneRepMax: 120 });
    const d = point({ sessionLogId: "d", date: "2026-08-22T00:00:00+00:00", estimatedOneRepMax: 130 });
    const ids = (sorted: ExerciseProgressionPoint[]) => sorted.map((p) => p.sessionLogId);
    expect(ids(sortSessions([a, b, c, d], { column: "e1rm", order: "desc" }))).toEqual(["d", "c", "a", "b"]);
    expect(ids(sortSessions([a, b, c, d], { column: "e1rm", order: "asc" }))).toEqual(["c", "a", "d", "b"]);
    expect(ids(sortSessions([a, b, c, d], DEFAULT_SESSION_SORT))).toEqual(["d", "c", "b", "a"]);
  });
});
