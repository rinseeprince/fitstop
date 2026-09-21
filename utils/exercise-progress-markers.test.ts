import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ExerciseBest, ExerciseProgressionPoint } from "@/types/training";
import {
  BEST_KINDS,
  BEST_KIND_LABELS,
  EXERCISE_TYPE_BEST_KINDS,
  EXERCISE_TYPE_MARKERS,
  PR_EMPTY_HINTS,
  PROGRESS_MARKERS,
  PROGRESS_MARKER_SPECS,
  effectiveMarker,
  hasMarkerValue,
  isBestKind,
  markerLens,
  offeredMarkers,
  orderedBestKinds,
  type BestKind,
} from "./exercise-progress-markers";
import { EXERCISE_TYPES } from "./exercise-types";
import { aggregateSessionMarkers, type MarkerSet } from "./exercise-session-markers";
import { LOGGED_MEASURES, SET_LOG_MEASURES, emptyLoggedActuals } from "./set-log-measures";

/** A working set recording nothing — every measure a set can carry. */
function markerSet(): MarkerSet {
  const { tempo: _tempo, ...measures } = emptyLoggedActuals();
  return { setType: "working", ...measures };
}

const MIGRATIONS = join(process.cwd(), "supabase/migrations");

/** A function as the database runs it: from its CREATE in the last migration that defines it to its body's end. */
function latestFunction(name: string): string {
  const header = `CREATE OR REPLACE FUNCTION ${name}(`;
  const defining = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    .map((file) => readFileSync(join(MIGRATIONS, file), "utf8"))
    .filter((sql) => sql.includes(header));
  const sql = defining[defining.length - 1];
  const start = sql.indexOf(header);
  return sql.slice(start, sql.indexOf("$$;", start));
}

/** One CTE's text inside the function: from `name AS (` to the next CTE. */
function cte(body: string, name: string, next: string): string {
  const start = body.indexOf(`${name} AS (`);
  return body.slice(start, body.indexOf(`${next} AS (`, start));
}

function point(overrides: Partial<ExerciseProgressionPoint> = {}): ExerciseProgressionPoint {
  return {
    date: "2026-09-01T00:00:00Z",
    sessionLogId: "sl-1",
    eventId: null,
    sets: [],
    totalReps: null,
    totalDurationSeconds: null,
    averagePaceSecondsPerKm: null,
    averageSplitSecondsPer500m: null,
    averageStrokeRate: null,
    averagePower: null,
    topSetWeight: null,
    topSetReps: null,
    rpe: null,
    topSetDistanceMeters: null,
    topSetDurationSeconds: null,
    estimatedOneRepMax: null,
    totalVolume: null,
    bestSetReps: null,
    totalDistanceMeters: null,
    longestHoldSeconds: null,
    maxHeartRateZone: null,
    prescribedSets: 3,
    actualSets: 3,
    prescribedRepsMin: null,
    prescribedRepsMax: null,
    ...overrides,
  };
}

const lift = point({ topSetWeight: 100, topSetReps: 5, estimatedOneRepMax: 116.7, totalVolume: 1500 });

describe("the marker table", () => {
  it("names every marker once, with a spec keyed by itself", () => {
    expect(new Set(PROGRESS_MARKERS).size).toBe(PROGRESS_MARKERS.length);
    for (const marker of PROGRESS_MARKERS) {
      expect(PROGRESS_MARKER_SPECS[marker].key).toBe(marker);
    }
  });

  it("gives every type lead markers that exist, once each, with Compliance the coach's on every type", () => {
    for (const type of EXERCISE_TYPES) {
      const keys = EXERCISE_TYPE_MARKERS[type].map((l) => l.key);
      expect(keys.length).toBeGreaterThan(0);
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys).toContain("compliance");
      expect(keys.some((k) => !PROGRESS_MARKER_SPECS[k].coachOnly)).toBe(true);
    }
  });

  it("keeps Strength's five lenses in their order (section 4.4: strength charts are unchanged)", () => {
    expect(EXERCISE_TYPE_MARKERS.strength.map((l) => l.key)).toEqual([
      "weight",
      "e1rm",
      "volume",
      "rpe",
      "compliance",
    ]);
  });

  it("gives each type the markers section 4.4 names", () => {
    expect(EXERCISE_TYPE_MARKERS.bodyweight.map((l) => l.key)).toEqual(["reps", "compliance"]);
    expect(EXERCISE_TYPE_MARKERS.endurance.map((l) => l.key)).toEqual(["pace", "distance", "compliance"]);
    expect(EXERCISE_TYPE_MARKERS.erg.map((l) => l.key)).toEqual(["split", "power", "compliance"]);
    expect(EXERCISE_TYPE_MARKERS.carry_sled.map((l) => l.key)).toEqual(["weight", "time", "compliance"]);
    expect(EXERCISE_TYPE_MARKERS.holds.map((l) => l.key)).toEqual(["hold", "compliance"]);
  });

  it("stars only markers that have a best", () => {
    for (const marker of PROGRESS_MARKERS) {
      const spec = PROGRESS_MARKER_SPECS[marker];
      if (spec.star) expect(spec.better).not.toBeNull();
    }
  });
});

describe("markerLens", () => {
  it("uses the type's words where it leads with the marker", () => {
    expect(markerLens("carry_sled", "weight").label).toBe("Load");
    expect(markerLens("carry_sled", "weight").title).toBe("Heaviest carry over time");
    expect(markerLens("holds", "hold").label).toBe("Longest hold");
    expect(markerLens("bodyweight", "reps").label).toBe("Best set reps");
  });

  it("uses the marker's own words elsewhere", () => {
    expect(markerLens("strength", "weight").label).toBe("Weight");
    expect(markerLens("strength", "hold").label).toBe("Longest time");
    expect(markerLens("endurance", "reps").label).toBe("Reps");
  });
});

describe("offeredMarkers", () => {
  it("offers a Strength exercise its five lenses and nothing else on strength logs", () => {
    expect(offeredMarkers("strength", [lift], "coach")).toEqual([
      "weight",
      "e1rm",
      "volume",
      "rpe",
      "compliance",
    ]);
  });

  it("never offers the client the coach's lenses", () => {
    expect(offeredMarkers("strength", [lift], "client")).toEqual(["weight", "e1rm", "volume"]);
    expect(offeredMarkers("holds", [], "client")).toEqual(["hold"]);
  });

  it("offers a type's leads even when nothing was logged for them", () => {
    expect(offeredMarkers("endurance", [], "coach")).toEqual(["pace", "distance", "compliance"]);
    expect(offeredMarkers("endurance", [lift], "coach")).toEqual([
      "pace",
      "distance",
      "compliance",
      "weight",
      "e1rm",
      "volume",
    ]);
  });

  it("follows what was logged: a weighted set on a Bodyweight exercise offers the lift's markers after its own", () => {
    const weighted = point({ bestSetReps: 12, topSetWeight: 10, topSetReps: 5, estimatedOneRepMax: 11.7, totalVolume: 50 });
    expect(offeredMarkers("bodyweight", [weighted], "coach")).toEqual([
      "reps",
      "compliance",
      "weight",
      "e1rm",
      "volume",
    ]);
    expect(offeredMarkers("bodyweight", [weighted], "client")).toEqual(["reps", "weight", "e1rm", "volume"]);
  });

  it("offers RPE to the coach on any exercise whose sets recorded one — a run, a plank, a bodyweight set", () => {
    // Points as the kernel makes them: no loaded set, so the highest RPE logged
    const session = (sets: Partial<MarkerSet>[]) =>
      point(aggregateSessionMarkers(sets.map((s) => ({ ...markerSet(), ...s }))));
    const run = session([{ distanceMeters: 5000, durationSeconds: 1500, paceSecondsPerKm: 300, rpe: 7 }]);
    // A distance with a time is a timed distance too, so Time follows as well
    expect(offeredMarkers("endurance", [run], "coach")).toEqual(["pace", "distance", "compliance", "rpe", "time"]);
    expect(offeredMarkers("endurance", [run], "client")).toEqual(["pace", "distance", "time"]);

    const plank = session([{ durationSeconds: 90, rpe: 8 }]);
    expect(offeredMarkers("holds", [plank], "coach")).toContain("rpe");
    const pullUps = session([{ reps: 12, rpe: 9 }]);
    expect(offeredMarkers("bodyweight", [pullUps], "coach")).toContain("rpe");
  });

  it("offers a Strength exercise a hold or a timed set when one was logged", () => {
    const plank = point({ longestHoldSeconds: 90 });
    expect(offeredMarkers("strength", [plank], "coach")).toEqual([
      "weight",
      "e1rm",
      "volume",
      "rpe",
      "compliance",
      "hold",
    ]);
    const sled = point({ topSetWeight: 80, totalDurationSeconds: 30, totalDistanceMeters: 60 });
    expect(offeredMarkers("strength", [sled], "client")).toEqual(["weight", "e1rm", "volume", "distance", "time"]);
  });

  it("offers a rate only where the type measures one: pace on Endurance, split on Erg, never on a carry", () => {
    const session = (sets: Partial<MarkerSet>[]) =>
      point(aggregateSessionMarkers(sets.map((s) => ({ ...markerSet(), ...s }))));
    // Any time over a distance gives both rates
    const timed = session([{ distanceMeters: 2000, durationSeconds: 480 }]);
    expect(timed.averagePaceSecondsPerKm).toBe(240);
    expect(timed.averageSplitSecondsPer500m).toBe(120);
    expect(offeredMarkers("endurance", [timed], "coach")).toContain("pace");
    expect(offeredMarkers("endurance", [timed], "coach")).not.toContain("split");
    expect(offeredMarkers("erg", [timed], "coach")).toContain("split");
    expect(offeredMarkers("erg", [timed], "coach")).not.toContain("pace");
    const carry = session([{ weight: 64, distanceMeters: 40, durationSeconds: 35 }]);
    expect(offeredMarkers("carry_sled", [carry], "coach")).not.toContain("pace");
    expect(offeredMarkers("carry_sled", [carry], "coach")).not.toContain("split");
  });

  it("offers no lens off repeats: a run's reps give no Reps lens, a carry's no e1RM or Volume (owner, 2026-09-21)", () => {
    const session = (sets: Partial<MarkerSet>[]) =>
      point(aggregateSessionMarkers(sets.map((s) => ({ ...markerSet(), ...s }))));
    // The owner's run on 21 Sep: 3 reps each of 1 km, 800 m, 600 m and 400 m, paces typed
    const run = session([
      { reps: 3, distanceMeters: 1000, paceSecondsPerKm: 270 },
      { reps: 3, distanceMeters: 800, paceSecondsPerKm: 255 },
      { reps: 3, distanceMeters: 600, paceSecondsPerKm: 240 },
      { reps: 3, distanceMeters: 400, paceSecondsPerKm: 225 },
    ]);
    expect(offeredMarkers("endurance", [run], "coach")).not.toContain("reps");
    expect(offeredMarkers("endurance", [run], "client")).not.toContain("reps");

    const carry = session([{ weight: 64, reps: 3, distanceMeters: 40 }]);
    expect(offeredMarkers("carry_sled", [carry], "coach")).toEqual(["weight", "time", "compliance", "distance"]);

    // A pull-up set still offers its Reps lens
    expect(offeredMarkers("endurance", [session([{ reps: 12 }])], "coach")).toContain("reps");
  });

  it("reads a value on any session in the window", () => {
    expect(hasMarkerValue("pace", [point(), point({ averagePaceSecondsPerKm: 280 })])).toBe(true);
    expect(hasMarkerValue("pace", [point(), point()])).toBe(false);
  });
});

describe("effectiveMarker", () => {
  it("keeps the picked lens while it is offered and falls back to the first otherwise", () => {
    expect(effectiveMarker("pace", ["pace", "distance"])).toBe("pace");
    expect(effectiveMarker("pace", ["weight", "e1rm"])).toBe("weight");
  });
});

describe("the bests", () => {
  it("names every kind once, labelled, and each type's own kinds exist", () => {
    expect(new Set(BEST_KINDS).size).toBe(BEST_KINDS.length);
    for (const kind of BEST_KINDS) expect(BEST_KIND_LABELS[kind]).toBeTruthy();
    for (const type of EXERCISE_TYPES) {
      expect(EXERCISE_TYPE_BEST_KINDS[type].length).toBeGreaterThan(0);
      for (const kind of EXERCISE_TYPE_BEST_KINDS[type]) expect(isBestKind(kind)).toBe(true);
      expect(PR_EMPTY_HINTS[type]).toBeTruthy();
    }
    expect(isBestKind("fastest_mile")).toBe(false);
  });

  it("mirrors the kinds ExerciseBest can be", () => {
    // Type-level: each side assignable to the other.
    const fromType: BestKind = "rep_max" as ExerciseBest["kind"];
    const toType: ExerciseBest["kind"] = "rep_max" as BestKind;
    expect(fromType).toBe(toType);
  });

  it("orders an exercise's kinds with its own first, then the rest as logged", () => {
    const present = new Set<BestKind>(["rep_max", "best_reps", "longest_hold"]);
    expect(orderedBestKinds("bodyweight", present)).toEqual(["best_reps", "rep_max", "longest_hold"]);
    expect(orderedBestKinds("strength", present)).toEqual(["rep_max", "best_reps", "longest_hold"]);
    expect(orderedBestKinds("carry_sled", new Set<BestKind>(["best_time", "heaviest_carry"]))).toEqual([
      "heaviest_carry",
      "best_time",
    ]);
    expect(orderedBestKinds("endurance", new Set())).toEqual([]);
  });
});

describe("the progression window, as the latest migration defines it, mirrors the tables", () => {
  const sql = latestFunction("get_exercise_progression_window");

  it("returns every numeric measure of a logged set from the progression window", () => {
    const returnsStart = sql.indexOf("RETURNS TABLE (");
    const returnsEnd = sql.indexOf(")", returnsStart);
    const returned = sql
      .slice(returnsStart, returnsEnd)
      .split("\n")
      .map((line) => line.trim().split(/\s+/)[0])
      .filter(Boolean);
    for (const measure of LOGGED_MEASURES) {
      expect(returned, `${SET_LOG_MEASURES[measure].column} is returned`).toContain(
        SET_LOG_MEASURES[measure].column,
      );
    }
  });
});

describe("exercise_records, as the latest migration defines it", () => {
  const body = latestFunction("exercise_records");

  it("computes every best kind and no other", () => {
    const literals = [...body.matchAll(/'([a-z_]+)'::TEXT AS kind/g)].map((m) => m[1]);
    expect(new Set(literals)).toEqual(new Set(BEST_KINDS));
  });

  it("never reads repeats as reps: a rep max and a best set skip a set with a distance or a duration (migration 190)", () => {
    // The kernel's isLift and isBodyweightSet read the same sets
    for (const [name, next] of [
      ["rep_max", "best_reps"],
      ["best_reps", "best_time"],
    ]) {
      const where = cte(body, name, next);
      expect(where, `${name} skips a distance`).toContain("s.distance_meters IS NULL");
      expect(where, `${name} skips a duration`).toContain("s.duration_seconds IS NULL");
    }
  });
});
