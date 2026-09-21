import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXERCISE_TYPE_RACE_DISTANCES,
  RACE_DISTANCES,
  RACE_DISTANCE_SPECS,
  RACE_DISTANCE_TOLERANCE,
  isRaceDistance,
  raceName,
} from "./race-distances";
import { EXERCISE_TYPES } from "./exercise-types";

const MIGRATIONS = join(process.cwd(), "supabase/migrations");

/** exercise_records as the database runs it: its body in the last migration that defines it. */
function latestRecordsFunction(): string {
  const defining = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    .map((file) => readFileSync(join(MIGRATIONS, file), "utf8"))
    .filter((sql) => sql.includes("CREATE OR REPLACE FUNCTION exercise_records("));
  const sql = defining[defining.length - 1];
  const start = sql.indexOf("CREATE OR REPLACE FUNCTION exercise_records(");
  return sql.slice(start, sql.indexOf("$$;", start));
}

/** The races the function buckets by: its `races` VALUES, row for row. */
function sqlRaces(body: string): { type: string; race: string; meters: number }[] {
  const start = body.indexOf("races (exercise_type, race, meters) AS (");
  const values = body.slice(start, body.indexOf("),\n  timed AS (", start));
  return [...values.matchAll(/\('([a-z_]+)', '([a-z0-9_]+)', ([\d.]+)(?:::NUMERIC)?\)/g)].map((m) => ({
    type: m[1],
    race: m[2],
    meters: Number(m[3]),
  }));
}

describe("the race distances", () => {
  it("are the owner's lists: Endurance and Erg, shortest first (section 4.4)", () => {
    expect(EXERCISE_TYPE_RACE_DISTANCES.endurance?.map(raceName)).toEqual([
      "400 m",
      "800 m",
      "1 km",
      "1600 m",
      "1 mile",
      "5 km",
      "10 km",
      "Half marathon",
      "Marathon",
      "50 km",
      "100 km",
    ]);
    expect(EXERCISE_TYPE_RACE_DISTANCES.erg?.map(raceName)).toEqual([
      "500 m",
      "1 km",
      "2 km",
      "5 km",
      "6 km",
      "10 km",
      "Half marathon",
      "Marathon",
    ]);
    for (const races of Object.values(EXERCISE_TYPE_RACE_DISTANCES)) {
      const meters = races.map((race) => RACE_DISTANCE_SPECS[race].meters);
      expect(meters).toEqual([...meters].sort((a, b) => a - b));
    }
  });

  it("give only Endurance and Erg races — every other type keeps exact distances", () => {
    const withRaces = EXERCISE_TYPES.filter((type) => EXERCISE_TYPE_RACE_DISTANCES[type]);
    expect(withRaces).toEqual(["endurance", "erg"]);
  });

  it("name every race the lists use, and nothing else", () => {
    const used = new Set(Object.values(EXERCISE_TYPE_RACE_DISTANCES).flat());
    expect(new Set(RACE_DISTANCES)).toEqual(used);
    expect(isRaceDistance("5k")).toBe(true);
    expect(isRaceDistance("5000")).toBe(false);
    expect(isRaceDistance(null)).toBe(false);
  });

  it("put the mile at its own length, 9 m past 1600 m", () => {
    expect(RACE_DISTANCE_SPECS.mile.meters - RACE_DISTANCE_SPECS["1600m"].meters).toBeCloseTo(9.344, 3);
    expect(RACE_DISTANCE_SPECS.half_marathon.meters).toBe(21097.5);
    expect(RACE_DISTANCE_SPECS.marathon.meters).toBe(42195);
  });
});

describe("exercise_records, as the latest migration defines it", () => {
  const body = latestRecordsFunction();

  it("buckets by this table, row for row", () => {
    const expected = Object.entries(EXERCISE_TYPE_RACE_DISTANCES).flatMap(([type, races]) =>
      (races ?? []).map((race) => ({ type, race, meters: RACE_DISTANCE_SPECS[race].meters })),
    );
    expect(sqlRaces(body)).toEqual(expected);
  });

  it("counts a set within half a percent of a race, and for the nearer of two", () => {
    expect(RACE_DISTANCE_TOLERANCE).toBe(0.005);
    expect(body).toContain(`ABS(s.distance_meters - r.meters) <= r.meters * ${RACE_DISTANCE_TOLERANCE}`);
    // Nearer wins — 1600 m and the mile split the difference — the shorter on an exact tie
    expect(body).toContain("ORDER BY ABS(s.distance_meters - r.meters) ASC, r.meters ASC");
  });

  it("gives a set at no race distance no best time, on a type with races", () => {
    expect(body).toContain("bucket.race IS NOT NULL");
    expect(body).toContain("OR NOT EXISTS (SELECT 1 FROM races r WHERE r.exercise_type = s.exercise_type)");
  });

  it("reads a set's time as the Sessions table does: typed, else its pace or split over its distance", () => {
    expect(body.replace(/\s+/g, " ")).toContain(
      "COALESCE( s.duration_seconds, s.pace_seconds_per_km * s.distance_meters / 1000, s.split_seconds_per_500m * s.distance_meters / 500 ) AS time_seconds",
    );
  });
});
