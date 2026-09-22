import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXERCISE_TYPE,
  EXERCISE_TYPE_LABELS,
  EXERCISE_TYPES,
  isExerciseType,
  toExerciseType,
} from "./exercise-types";
import { COLUMN_PRESET_FIELDS, COLUMN_PRESETS, presetColumnsForType } from "./column-presets";

// The type list is defined once in code and mirrored by migration 185's
// CHECK; the global catalog's classification is written twice — the
// migrations' name lists for a live catalog (185's, then 189's for the
// exercises done with bodyweight alone), the seed CSV's Type column for a
// fresh one — and must be the same classification. These tests read the
// files, so none can drift from the code or from the others silently.
const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const MIGRATION = readFileSync(join(MIGRATIONS, "185_exercise_types.sql"), "utf8");
const CSV = readFileSync(join(process.cwd(), "scripts/data/exercises.csv"), "utf8");

/** Every migration that sets a global exercise's type, in the order they run. */
const CLASSIFYING = readdirSync(MIGRATIONS)
  .filter((file) => file.endsWith(".sql"))
  .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
  .map((file) => readFileSync(join(MIGRATIONS, file), "utf8"))
  .filter((sql) => sql.includes("SET exercise_type"));

/** The quoted names of one `ARRAY[ … ]` literal, SQL's doubled quotes undone. */
const sqlNames = (literal: string): string[] =>
  [...literal.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));

/** Each name list the migrations set a type by, in the order they run. */
const nameLists = CLASSIFYING.flatMap((sql) =>
  [
    ...sql.matchAll(
      /SET exercise_type = '(\w+)'\s+WHERE coach_id IS NULL AND lower\(name\) = ANY \(ARRAY\[([^\]]+)\]::TEXT\[\]\)/g,
    ),
  ].map((m) => ({ type: m[1], names: sqlNames(m[2]) })),
);

/** One CSV line's cells; a quoted cell may hold commas (the aliases). */
function csvCells(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else cell += ch;
  }
  cells.push(cell);
  return cells.map((c) => c.trim());
}

const csvLines = CSV.split(/\r?\n/).filter((line) => line.trim().length > 0);
const header = csvCells(csvLines[0]);
const rows = csvLines.slice(1).map(csvCells);
const nameOf = (row: string[]) => row[header.indexOf("Name")];
const typeOf = (row: string[]) => row[header.indexOf("Type")];
const equipmentOf = (row: string[]) => row[header.indexOf("Equipment")];

describe("the types and migration 185 agree", () => {
  it("names six distinct types, each labelled, Strength the default", () => {
    expect(EXERCISE_TYPES).toHaveLength(6);
    expect(new Set(EXERCISE_TYPES).size).toBe(6);
    for (const type of EXERCISE_TYPES) {
      expect(EXERCISE_TYPE_LABELS[type].length).toBeGreaterThan(0);
      expect(isExerciseType(type)).toBe(true);
    }
    expect(DEFAULT_EXERCISE_TYPE).toBe("strength");
    expect(isExerciseType("cardio")).toBe(false);
    expect(isExerciseType("circuit")).toBe(false);
  });

  it("the column's CHECK lists exactly the code's types, in the code's order, and defaults to Strength", () => {
    const check = MIGRATION.match(/CHECK \(exercise_type = ANY \(ARRAY\[([^\]]+)\]::TEXT\[\]\)\)/);
    expect(check).not.toBeNull();
    expect(sqlNames(check![1])).toEqual([...EXERCISE_TYPES]);
    expect(MIGRATION).toMatch(/exercise_type TEXT NOT NULL DEFAULT 'strength'/);
  });

  it("the presets are one per type, plus Circuit, and a type's preset is a lookup", () => {
    expect(COLUMN_PRESETS).toEqual([...EXERCISE_TYPES, "circuit"]);
    for (const type of EXERCISE_TYPES) {
      expect(presetColumnsForType(type)).toEqual([...COLUMN_PRESET_FIELDS[type]]);
    }
  });

  it("a preset comes back as a fresh array", () => {
    const erg = presetColumnsForType("erg");
    erg.push("reps");
    expect(presetColumnsForType("erg")).toEqual([...COLUMN_PRESET_FIELDS.erg]);
  });

  it("reads a stored value as its type, and anything else as Strength", () => {
    expect(toExerciseType("holds")).toBe("holds");
    for (const stored of [null, undefined, "", "cardio", "Strength"]) {
      expect(toExerciseType(stored)).toBe("strength");
    }
  });
});

describe("the seed CSV and the migrations classify the catalog identically", () => {
  it("every CSV row carries a known type, under a Type header", () => {
    expect(header).toContain("Type");
    expect(rows.length).toBeGreaterThan(1500);
    for (const row of rows) {
      expect(row).toHaveLength(header.length);
      expect(isExerciseType(typeOf(row))).toBe(true);
    }
  });

  it("the CSV's names are unique, as the catalog's unique index requires", () => {
    const names = rows.map((row) => nameOf(row).toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it("every type a migration sets on a global exercise is set by a list of CSV names", () => {
    const statements = CLASSIFYING.join("\n").match(/SET exercise_type/g) ?? [];
    expect(nameLists).toHaveLength(statements.length);
    const csvNames = new Set(rows.map((row) => nameOf(row).toLowerCase()));
    for (const { type, names } of nameLists) {
      expect(isExerciseType(type)).toBe(true);
      expect(new Set(names).size).toBe(names.length);
      expect(names.filter((name) => !csvNames.has(name))).toEqual([]);
    }
  });

  it("the migrations' name lists, run in order, leave exactly the CSV's non-Strength rows on each type", () => {
    const typed = new Map<string, string>();
    for (const { type, names } of nameLists) for (const name of names) typed.set(name, type);
    for (const type of EXERCISE_TYPES.filter((t) => t !== "strength")) {
      const byMigrations = [...typed].filter(([, t]) => t === type).map(([name]) => name).sort();
      const inCsv = rows
        .filter((row) => typeOf(row) === type)
        .map((row) => nameOf(row).toLowerCase())
        .sort();
      expect(byMigrations).toEqual(inCsv);
    }
  });

  it("an exercise done with bodyweight alone is never Strength unless it is a weighted variant (owner, 2026-09-21)", () => {
    const strength = rows
      .filter((row) => equipmentOf(row) === "bodyweight" && typeOf(row) === "strength")
      .map(nameOf);
    expect(strength.filter((name) => !/weighted/i.test(name))).toEqual([]);
    for (const name of ["Pull Up", "Chin Up", "Push Up", "Dip", "Pistol Squat", "Burpee"]) {
      expect(typeOf(rows.find((row) => nameOf(row) === name)!)).toBe("bodyweight");
    }
    expect(typeOf(rows.find((row) => nameOf(row) === "Couch Stretch")!)).toBe("holds");
  });

  it("Burpee Broad Jump is in the CSV as Bodyweight and inserted by the migration", () => {
    const row = rows.find((r) => nameOf(r) === "Burpee Broad Jump");
    expect(row).toBeDefined();
    expect(typeOf(row!)).toBe("bodyweight");
    expect(MIGRATION).toMatch(
      /SELECT NULL, 'Burpee Broad Jump', 'full_body', 'bodyweight', 'plyometric',\s+ARRAY\[[^\]]+\]::TEXT\[\], 'bodyweight'/,
    );
    expect(MIGRATION).toMatch(/lower\(name\) = 'burpee broad jump'/);
  });
});
