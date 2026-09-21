import type { ExerciseType } from "./exercise-types";

// The race distances an Endurance and an Erg exercise's best times are kept at
// (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md section 4.4, owner 2026-09-21). A
// set counts for a race when it is within half a percent of it, for the nearer
// where two are that close (1600 m and the mile are 9 m apart), and a set at no
// race distance earns no best time — no time is estimated. Every other type
// keeps its best times per exact logged distance. The lists are rules of the
// exercise type: nothing is stored for them.
//
// The matching runs in the database. exercise_records (migration 191) is the
// one statement of it and carries this table row for row, which
// utils/race-distances.test.ts holds it to; a record at a race names it by its
// key, and here is the race's name for every screen that reads one.

export const RACE_DISTANCES = [
  "400m",
  "500m",
  "800m",
  "1k",
  "1600m",
  "mile",
  "2k",
  "5k",
  "6k",
  "10k",
  "half_marathon",
  "marathon",
  "50k",
  "100k",
] as const;

export type RaceDistance = (typeof RACE_DISTANCES)[number];

/**
 * Each race's name and length. The name reads the same for every viewer: a
 * race is an event's name, not a measurement to convert — an imperial runner's
 * 5 km is "5 km", never "3.1 mi" (owner, 2026-09-21).
 */
export const RACE_DISTANCE_SPECS: Record<RaceDistance, { name: string; meters: number }> = {
  "400m": { name: "400 m", meters: 400 },
  "500m": { name: "500 m", meters: 500 },
  "800m": { name: "800 m", meters: 800 },
  "1k": { name: "1 km", meters: 1000 },
  "1600m": { name: "1600 m", meters: 1600 },
  mile: { name: "1 mile", meters: 1609.344 },
  "2k": { name: "2 km", meters: 2000 },
  "5k": { name: "5 km", meters: 5000 },
  "6k": { name: "6 km", meters: 6000 },
  "10k": { name: "10 km", meters: 10000 },
  half_marathon: { name: "Half marathon", meters: 21097.5 },
  marathon: { name: "Marathon", meters: 42195 },
  "50k": { name: "50 km", meters: 50000 },
  "100k": { name: "100 km", meters: 100000 },
};

/** The races each type keeps its best times at, shortest first; a type with none keeps exact distances. */
export const EXERCISE_TYPE_RACE_DISTANCES: Partial<Record<ExerciseType, readonly RaceDistance[]>> = {
  endurance: ["400m", "800m", "1k", "1600m", "mile", "5k", "10k", "half_marathon", "marathon", "50k", "100k"],
  erg: ["500m", "1k", "2k", "5k", "6k", "10k", "half_marathon", "marathon"],
};

/** How near a set's distance must be to a race's to count for it: half a percent either way. */
export const RACE_DISTANCE_TOLERANCE = 0.005;

const RACE_SET: ReadonlySet<string> = new Set(RACE_DISTANCES);

export function isRaceDistance(value: unknown): value is RaceDistance {
  return typeof value === "string" && RACE_SET.has(value);
}

/** A race's name: "5 km", "1 mile", "Half marathon". */
export function raceName(race: RaceDistance): string {
  return RACE_DISTANCE_SPECS[race].name;
}
