import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRESCRIBED_FIELDS,
  isPrescribedField,
  PRESCRIBED_FIELD_LABELS,
  PRESCRIBED_FIELDS,
  resolvePrescribedFields,
  toPrescribedFields,
} from "./prescribed-fields";

// The column list is defined once in code and mirrored by migration 183's
// CHECK. This test reads the migration file, so the two cannot drift silently:
// a column added to one and not the other fails here.
const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/183_measurement_columns_the_prescription.sql"),
  "utf8",
);

/** Every quoted name inside an `ARRAY[ … ]::TEXT[]` literal, in order. */
function arrayLiterals(sql: string): string[][] {
  return [...sql.matchAll(/ARRAY\[([^\]]+)\]::TEXT\[\]/g)].map((m) =>
    [...m[1].matchAll(/'([a-z_]+)'/g)].map((name) => name[1]),
  );
}

describe("the column list and migration 183 agree", () => {
  it("names nineteen distinct columns", () => {
    expect(PRESCRIBED_FIELDS).toHaveLength(19);
    expect(new Set(PRESCRIBED_FIELDS).size).toBe(19);
  });

  it("the CHECK on both tables lists exactly the code's columns, in the code's order", () => {
    const checks = arrayLiterals(MIGRATION).filter((names) => names.length > 5);
    expect(checks).toHaveLength(2);
    for (const names of checks) expect(names).toEqual([...PRESCRIBED_FIELDS]);
  });

  it("the backfill writes today's five, as the code spells them", () => {
    const backfills = arrayLiterals(MIGRATION).filter((names) => names.length === 5);
    expect(backfills).toHaveLength(2);
    for (const names of backfills) expect(names).toEqual([...DEFAULT_PRESCRIBED_FIELDS]);
  });

  it("every column has a label and today's five are columns", () => {
    for (const field of PRESCRIBED_FIELDS) {
      expect(PRESCRIBED_FIELD_LABELS[field].length).toBeGreaterThan(0);
      expect(isPrescribedField(field)).toBe(true);
    }
    for (const field of DEFAULT_PRESCRIBED_FIELDS) expect(PRESCRIBED_FIELDS).toContain(field);
    expect(isPrescribedField("weight")).toBe(false);
  });
});

describe("toPrescribedFields", () => {
  it("keeps a known list in its own order", () => {
    expect(toPrescribedFields(["distance", "duration", "rest"])).toEqual([
      "distance",
      "duration",
      "rest",
    ]);
  });

  it("drops unknown names rather than trusting a TEXT[] column", () => {
    expect(toPrescribedFields(["reps", "weight", "load"])).toEqual(["reps", "load"]);
  });

  it("is never empty: null, absent, empty and wholly-unknown lists read as today's five", () => {
    for (const stored of [null, undefined, [], ["bogus"]]) {
      expect(toPrescribedFields(stored)).toEqual([...DEFAULT_PRESCRIBED_FIELDS]);
    }
  });

  it("returns a fresh array, never the shared default", () => {
    const a = toPrescribedFields(null);
    a.push("rir");
    expect(toPrescribedFields(null)).toEqual([...DEFAULT_PRESCRIBED_FIELDS]);
  });
});

describe("resolvePrescribedFields", () => {
  it("is the same list as a set", () => {
    const fields = resolvePrescribedFields(["pace", "split", "nonsense"]);
    expect([...fields]).toEqual(["pace", "split"]);
    expect(resolvePrescribedFields(null).size).toBe(5);
  });
});
