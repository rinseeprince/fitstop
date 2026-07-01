import { describe, it, expect } from "vitest";
import { countWorkingSets, type SetSpec } from "./exercise-set-specs";

function spec(setType: SetSpec["set_type"], setNumber = 1): SetSpec {
  return { set_number: setNumber, set_type: setType };
}

describe("countWorkingSets", () => {
  it("falls back to the compact count when set_specs is null/undefined", () => {
    expect(countWorkingSets(null, 3)).toBe(3);
    expect(countWorkingSets(undefined, 4)).toBe(4);
  });

  it("falls back when set_specs is an empty array", () => {
    expect(countWorkingSets([], 3)).toBe(3);
  });

  it("falls back when set_specs is not an array (garbage JSONB)", () => {
    expect(countWorkingSets({ nope: true }, 5)).toBe(5);
    expect(countWorkingSets("working", 2)).toBe(2);
  });

  it("counts every non-warmup set type", () => {
    const specs: SetSpec[] = [
      spec("warmup", 1),
      spec("working", 2),
      spec("working", 3),
      spec("amrap", 4),
      spec("drop", 5),
      spec("failure", 6),
    ];
    // 6 specs, 1 warmup excluded -> 5 counted. fallback ignored.
    expect(countWorkingSets(specs, 99)).toBe(5);
  });

  it("returns 0 for an all-warmup exercise (authoring forbids this in Phase 2)", () => {
    expect(countWorkingSets([spec("warmup", 1), spec("warmup", 2)], 4)).toBe(0);
  });

  it("treats a spec missing set_type as non-warmup", () => {
    const specs = [{ set_number: 1 }, spec("warmup", 2)] as unknown;
    expect(countWorkingSets(specs, 9)).toBe(1);
  });
});
