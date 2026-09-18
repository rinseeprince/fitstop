import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOAD_KG_MAX } from "@/lib/constants";
import { SET_SPEC_MEASURES, TEMPO_PATTERN } from "./exercise-set-specs";
import { PRESCRIBED_FIELDS } from "./prescribed-fields";
import {
  actualsFromSetLogRow,
  actualsFromWire,
  BOX_LABELS,
  BOX_WORDS,
  boxEntry,
  boxKey,
  emptyLoggedActuals,
  LOGGED_BOXES,
  LOGGED_MEASURES,
  loggedBoxesFor,
  pickLoggedActuals,
  SET_LOG_MEASURES,
  SET_LOG_TEMPO,
  setLogColumnsFromActuals,
} from "./set-log-measures";

// The table is defined once in code and mirrored by migration 184's columns
// and CHECKs. This test reads the migration file, so the two cannot drift
// silently: a bound, a type or a scale changed in one and not the other fails
// here. reps, weight and rpe predate it (migration 090) and are pinned to the
// live constraints as probed on DEV, 2026-09-18.
const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/184_measurement_columns_the_actuals.sql"),
  "utf8",
);

const MIGRATION_090 = readFileSync(
  join(process.cwd(), "supabase/migrations/090_normalize_set_logs.sql"),
  "utf8",
);

function columnDefinition(column: string, sql: string) {
  const pattern = new RegExp(
    `${column} (NUMERIC\\((\\d+),(\\d+)\\)|INTEGER|INT)\\s+CHECK \\(${column} IS NULL OR \\(${column} >= ([\\d.]+) AND ${column} <= ([\\d.]+)\\)\\)`,
  );
  const match = pattern.exec(sql);
  if (!match) throw new Error(`no definition for ${column}`);
  const [, type, , scale, floor, ceiling] = match;
  return {
    integer: type === "INTEGER" || type === "INT",
    scale: type === "INTEGER" || type === "INT" ? 0 : Number(scale),
    floor: Number(floor),
    ceiling: Number(ceiling),
  };
}

describe("the actuals table and migration 184 agree", () => {
  it("every numeric measure added by 184 has the table's type, scale and bounds", () => {
    for (const measure of LOGGED_MEASURES) {
      if (measure === "reps" || measure === "load" || measure === "rpe") continue;
      const spec = SET_LOG_MEASURES[measure];
      expect(columnDefinition(spec.column, MIGRATION), spec.column).toEqual({
        integer: spec.integer,
        scale: spec.scale,
        floor: spec.floor,
        ceiling: spec.ceiling,
      });
    }
  });

  it("reps, weight and rpe keep migration 090's shape", () => {
    expect(columnDefinition("reps", MIGRATION_090)).toEqual({ integer: true, scale: 0, floor: 1, ceiling: 100 });
    expect(columnDefinition("weight", MIGRATION_090)).toEqual({ integer: false, scale: 2, floor: 0, ceiling: 2000 });
    expect(columnDefinition("rpe", MIGRATION_090)).toEqual({ integer: false, scale: 1, floor: 1, ceiling: 10 });
    expect(SET_LOG_MEASURES.reps).toMatchObject({ integer: true, scale: 0, floor: 1, ceiling: 100 });
    expect(SET_LOG_MEASURES.load).toMatchObject({ integer: false, scale: 2, floor: 0, ceiling: LOAD_KG_MAX });
    expect(SET_LOG_MEASURES.rpe).toMatchObject({ integer: false, scale: 1, floor: 1, ceiling: 10 });
    expect(LOAD_KG_MAX).toBe(2000);
  });

  it("the tempo column takes exactly the code's four-phase grammar", () => {
    expect(MIGRATION).toContain(`${SET_LOG_TEMPO.column} ~ '${TEMPO_PATTERN.source}'`);
  });

  it("every actual is bounded like its target, reps' floor aside", () => {
    for (const measure of LOGGED_MEASURES) {
      const spec = SET_LOG_MEASURES[measure];
      if (spec.target === null) continue;
      const target = SET_SPEC_MEASURES[spec.target];
      expect(spec.ceiling, measure).toBe(target.ceiling);
      expect(spec.integer, measure).toBe(target.integer);
      expect(spec.floor, measure).toBe(measure === "reps" ? 1 : target.floor);
    }
    expect(SET_LOG_MEASURES.rest.target).toBeNull();
  });

  it("no two measures share a wire key or a column", () => {
    const keys = LOGGED_MEASURES.map((m) => SET_LOG_MEASURES[m].key);
    const columns = LOGGED_MEASURES.map((m) => SET_LOG_MEASURES[m].column);
    expect(new Set([...keys, SET_LOG_TEMPO.key]).size).toBe(keys.length + 1);
    expect(new Set([...columns, SET_LOG_TEMPO.column]).size).toBe(columns.length + 1);
  });
});

describe("the boxes", () => {
  it("are every prescribed column but set type and rest, in the columns' order", () => {
    expect(LOGGED_BOXES).toEqual(PRESCRIBED_FIELDS.filter((f) => f !== "set_type" && f !== "rest"));
    expect(LOGGED_BOXES).toHaveLength(17);
    for (const box of LOGGED_BOXES) {
      expect(BOX_LABELS[box].length).toBeGreaterThan(0);
      expect(BOX_WORDS[box].length).toBeGreaterThan(0);
    }
  });

  it("loggedBoxesFor keeps the columns' order whatever the exercise's list says", () => {
    expect(loggedBoxesFor(new Set(["rest", "pace", "set_type", "distance", "load"]))).toEqual([
      "load",
      "distance",
      "pace",
    ]);
  });

  it("load's box is the weight key and tempo is its own", () => {
    expect(boxKey("load")).toBe("weight");
    expect(boxKey("distance")).toBe("distanceMeters");
    expect(boxKey("tempo")).toBe("tempo");
    expect(boxEntry("load")).toBe("load");
    expect(boxEntry("heart_rate_zone")).toBe("zone");
    expect(boxEntry("tempo")).toBe("tempo");
  });
});

describe("row and wire mapping", () => {
  const row = {
    id: "s1",
    exercise_log_id: "el",
    set_number: 1,
    set_type: "working",
    created_at: "",
    updated_at: "",
    reps: 8,
    weight: 100,
    rpe: 8,
    rir: 2,
    tempo: "3-1-X-0",
    distance_meters: 5000,
    duration_seconds: 1500.5,
    pace_seconds_per_km: 300,
    split_seconds_per_500m: 112.3,
    calories: 300,
    cadence: 90,
    stroke_rate: 28,
    resistance: 7,
    heart_rate_zone: 3,
    heart_rate: 150,
    power: 250,
    ftp_percent: 80,
    rest_seconds: 90,
  };

  it("a set_logs row round-trips through the actuals and back to its columns", () => {
    const actuals = actualsFromSetLogRow(row);
    expect(actuals).toEqual({
      reps: 8,
      weight: 100,
      rpe: 8,
      rir: 2,
      tempo: "3-1-X-0",
      distanceMeters: 5000,
      durationSeconds: 1500.5,
      paceSecondsPerKm: 300,
      splitSecondsPer500m: 112.3,
      calories: 300,
      cadence: 90,
      strokeRate: 28,
      resistance: 7,
      heartRateZone: 3,
      heartRate: 150,
      power: 250,
      ftpPercent: 80,
      restSeconds: 90,
    });
    const { id: _id, exercise_log_id: _e, set_number: _n, set_type: _t, created_at: _c, updated_at: _u, ...columns } = row;
    expect(setLogColumnsFromActuals(actuals)).toEqual(columns);
  });

  it("an empty set writes every column as null and records nothing", () => {
    const empty = emptyLoggedActuals();
    expect(Object.values(setLogColumnsFromActuals(empty)).every((v) => v === null)).toBe(true);
    expect(Object.keys(setLogColumnsFromActuals(empty))).toHaveLength(18);
  });

  it("the wire's weight takes the exercise's unit tag and every other measure is canonical", () => {
    const actuals = actualsFromWire({ weight: 225, reps: 5, distanceMeters: 400 }, "lbs");
    expect(actuals.weight).toBeCloseTo(225 * 0.45359237, 6);
    expect(actuals.reps).toBe(5);
    expect(actuals.distanceMeters).toBe(400);
    expect(actuals.tempo).toBeNull();
    expect(actualsFromWire({ weight: 100 }, "kg").weight).toBe(100);
  });

  it("pickLoggedActuals fills what a partial source leaves out", () => {
    expect(pickLoggedActuals({ reps: 10 })).toEqual({ ...emptyLoggedActuals(), reps: 10 });
    expect(pickLoggedActuals({ tempo: "2-0-2-0" }).tempo).toBe("2-0-2-0");
  });
});
