import { describe, it, expect } from "vitest";
import { commitEntryRange, commitLoad, commitNum, commitTempo, displayLoad } from "./commit-input";
import { SET_SPEC_MEASURES } from "@/utils/exercise-set-specs";

// A blur handler is not a pure function, so fake the one thing these read.
const blur = (value: string) =>
  ({ target: { value } }) as unknown as React.FocusEvent<HTMLInputElement>;

describe("displayLoad", () => {
  it("passes kilograms through unchanged for a metric viewer", () => {
    expect(displayLoad(100, "metric")).toBe("100");
    expect(displayLoad(47.5, "metric")).toBe("47.5");
  });

  it("converts WITHOUT snapping for an imperial viewer", () => {
    // formatLoad would give 220 here (nearest 5 lb). That is right for a
    // read-only readout and wrong for an editable field, because the snap would
    // round-trip into storage on the next blur.
    expect(displayLoad(100, "imperial")).toBe("220.5");
  });

  it("renders an absent load as an empty field", () => {
    expect(displayLoad(null, "imperial")).toBe("");
    expect(displayLoad(undefined, "metric")).toBe("");
  });
});

describe("commitLoad — focus-through must not write", () => {
  // THE regression this guard exists for. set-row-editor's input is
  // uncontrolled and writes on EVERY blur, so without the guard an imperial
  // coach opening a 100 kg session and tabbing past the field would store
  // 100.017 kg (via the rounded "220.5") having changed nothing. Per field.
  it("reports no change when the field is left exactly as seeded (imperial)", () => {
    const seeded = displayLoad(100, "imperial"); // "220.5"
    const result = commitLoad(blur(seeded), 100, "imperial", { min: 0, max: 2000 });

    expect(result.changed).toBe(false);
  });

  it("reports no change when the field is left exactly as seeded (metric)", () => {
    const result = commitLoad(blur(displayLoad(47.5, "metric")), 47.5, "metric", {
      min: 0,
      max: 2000,
    });

    expect(result.changed).toBe(false);
  });

  it("reports no change for an untouched empty field", () => {
    const result = commitLoad(blur(""), null, "imperial", { min: 0, max: 2000 });
    expect(result.changed).toBe(false);
  });

  it("does write when the coach actually edits, converting to kilograms", () => {
    const result = commitLoad(blur("225"), 100, "imperial", { min: 0, max: 2000 });

    expect(result.changed).toBe(true);
    if (result.changed) {
      // 225 lb = 102.058 kg, stored canonically.
      expect(result.valueKg).toBeCloseTo(102.058, 3);
    }
  });

  it("stores a metric edit verbatim", () => {
    const result = commitLoad(blur("105"), 100, "metric", { min: 0, max: 2000 });
    expect(result).toEqual({ changed: true, valueKg: 105 });
  });

  it("clamps in KILOGRAMS, not in the typed unit", () => {
    // 5000 lb is 2267 kg — the 2000 ceiling describes storage, so it clamps
    // there rather than letting 5000 through as "under 2000".
    const result = commitLoad(blur("5000"), 100, "imperial", { min: 0, max: 2000 });

    expect(result.changed).toBe(true);
    if (result.changed) expect(result.valueKg).toBe(2000);
  });

  it("clears the load when the field is emptied", () => {
    const result = commitLoad(blur(""), 100, "metric", { min: 0, max: 2000 });
    expect(result).toEqual({ changed: true, valueKg: null });
  });

  it("survives a full seed -> blur -> reseed cycle with no drift", () => {
    // Ten focus-throughs in a row must leave the stored value bit-identical.
    let stored: number | null = 100;
    for (let i = 0; i < 10; i++) {
      const commit = commitLoad(
        blur(displayLoad(stored, "imperial")),
        stored,
        "imperial",
        { min: 0, max: 2000 },
      );
      if (commit.changed) stored = commit.valueKg;
    }
    expect(stored).toBe(100);
  });
});

describe("commitNum", () => {
  it("clamps and normalizes the field", () => {
    const e = blur("150");
    expect(commitNum(e, { min: 0, max: 100 })).toBe(100);
    expect(e.target.value).toBe("100");
  });

  it("rounds when int is set", () => {
    expect(commitNum(blur("8.7"), { min: 0, max: 100, int: true })).toBe(9);
  });

  it("returns null for a blank or non-numeric field", () => {
    expect(commitNum(blur("  "), { min: 0, max: 100 })).toBeNull();
    expect(commitNum(blur("abc"), { min: 0, max: 100 })).toBeNull();
  });
});

describe("commitEntryRange — a unit-bearing range box", () => {
  const DISTANCE = SET_SPEC_MEASURES.distance;

  it("reports no change when the box is left exactly as seeded", () => {
    expect(commitEntryRange(blur("5 km"), { min: 5000, max: 5000 }, "distance", "metric", DISTANCE)).toEqual({
      changed: false,
    });
    expect(commitEntryRange(blur("3.11 mi"), { min: 5000, max: 5000 }, "distance", "imperial", DISTANCE)).toEqual({
      changed: false,
    });
  });

  it("commits a typed range canonically and writes its readback into the box", () => {
    const e = blur("400-800 m");
    expect(commitEntryRange(e, { min: 5000, max: 5000 }, "distance", "metric", DISTANCE)).toEqual({
      changed: true,
      range: { min: 400, max: 800 },
    });
    expect(e.target.value).toBe("400-800 m");
  });

  it("reverts a typo to the seeded string and writes nothing", () => {
    const e = blur("far");
    expect(commitEntryRange(e, { min: 5000, max: 5000 }, "distance", "metric", DISTANCE)).toEqual({
      changed: false,
    });
    expect(e.target.value).toBe("5 km");
  });
});

describe("commitTempo — one compound value", () => {
  it("accepts the four-phase grammar, reading a lower-case x as X", () => {
    const e = blur("3-1-x-0");
    expect(commitTempo(e, null)).toEqual({ changed: true, tempo: "3-1-X-0" });
    expect(e.target.value).toBe("3-1-X-0");
  });

  it("an emptied box clears the tempo; an unchanged one writes nothing", () => {
    expect(commitTempo(blur(""), "3-1-X-0")).toEqual({ changed: true, tempo: null });
    expect(commitTempo(blur("3-1-X-0"), "3-1-X-0")).toEqual({ changed: false });
    expect(commitTempo(blur(""), null)).toEqual({ changed: false });
  });

  it("reverts anything that isn't a tempo", () => {
    const e = blur("slow");
    expect(commitTempo(e, "3-1-X-0")).toEqual({ changed: false });
    expect(e.target.value).toBe("3-1-X-0");
  });
});
