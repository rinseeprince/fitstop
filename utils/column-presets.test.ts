import { describe, expect, it } from "vitest";
import {
  BUILDER_COLUMN_ORDER,
  COLUMN_GROUPS,
  COLUMN_PRESET_FIELDS,
  COLUMN_PRESETS,
  describePresetColumns,
  isColumnsPreset,
  orderColumns,
  presetColumns,
  presetOf,
} from "./column-presets";
import { DEFAULT_PRESCRIBED_FIELDS, PRESCRIBED_FIELDS } from "./prescribed-fields";

// The presets are put to the owner as exact column lists (commit 12). These
// pin them so a drift is a deliberate edit here, not a surprise in a smoke.
describe("the seven presets", () => {
  it("are exactly the columns put to the owner", () => {
    expect(COLUMN_PRESETS).toEqual([
      "strength",
      "bodyweight",
      "endurance",
      "erg",
      "carry_sled",
      "holds",
      "circuit",
    ]);
    expect(COLUMN_PRESET_FIELDS).toEqual({
      strength: ["set_type", "reps", "load", "rpe", "rest"],
      bodyweight: ["set_type", "reps", "rpe", "rest"],
      endurance: ["set_type", "distance", "duration", "pace", "heart_rate_zone", "rest"],
      erg: ["set_type", "distance", "duration", "split", "stroke_rate", "resistance", "rest"],
      carry_sled: ["set_type", "load", "distance", "duration", "rest"],
      holds: ["set_type", "rpe", "duration", "rest"],
      circuit: ["reps", "load"],
    });
  });

  it("Strength IS the columns a new exercise starts on", () => {
    expect(COLUMN_PRESET_FIELDS.strength).toBe(DEFAULT_PRESCRIBED_FIELDS);
  });

  it("every preset names known columns, at least two of them, in the builder's order", () => {
    for (const preset of COLUMN_PRESETS) {
      const columns = COLUMN_PRESET_FIELDS[preset];
      expect(columns.length).toBeGreaterThanOrEqual(2);
      for (const column of columns) expect(PRESCRIBED_FIELDS).toContain(column);
      expect(orderColumns(columns)).toEqual([...columns]);
      expect(isColumnsPreset(preset)).toBe(true);
    }
    expect(isColumnsPreset("cardio")).toBe(false);
  });

  it("describes a preset's columns by their labels", () => {
    expect(describePresetColumns("strength")).toBe("Set type · Reps · Load · RPE · Rest");
    expect(describePresetColumns("circuit")).toBe("Reps · Load");
  });
});

describe("the selector's groups and the builder's column order", () => {
  it("group every column exactly once as Strength, Endurance or Framework", () => {
    expect(COLUMN_GROUPS.map((group) => group.label)).toEqual(["Strength", "Endurance", "Framework"]);
    const grouped = COLUMN_GROUPS.flatMap((group) => group.fields);
    expect(new Set(grouped).size).toBe(PRESCRIBED_FIELDS.length);
    for (const field of PRESCRIBED_FIELDS) expect(grouped).toContain(field);
  });

  it("order every column once: set type, reps, load, the measures, rest", () => {
    expect(new Set(BUILDER_COLUMN_ORDER).size).toBe(PRESCRIBED_FIELDS.length);
    expect(BUILDER_COLUMN_ORDER.slice(0, 4)).toEqual(["set_type", "reps", "load", "rpe"]);
    expect(BUILDER_COLUMN_ORDER[BUILDER_COLUMN_ORDER.length - 1]).toBe("rest");
  });

  it("orderColumns puts a ticked column in its place, never at the end", () => {
    expect(orderColumns(new Set(["rest", "distance", "set_type"]))).toEqual([
      "set_type",
      "distance",
      "rest",
    ]);
    expect(orderColumns(["load", "reps"])).toEqual(["reps", "load"]);
  });
});

describe("presetColumns", () => {
  it("is exactly the preset's columns on a lone exercise", () => {
    expect(presetColumns("endurance", new Set(["set_type", "reps", "load", "rpe", "rest"]))).toEqual(
      COLUMN_PRESET_FIELDS.endurance,
    );
    expect(presetColumns("circuit", new Set(["set_type", "reps", "load", "rpe", "rest"]))).toEqual([
      "reps",
      "load",
    ]);
  });

  it("keeps the exercise's stored choice for a hidden column — Rest in a superset or circuit", () => {
    // Rest ticked before: a preset without Rest keeps it.
    expect(presetColumns("circuit", new Set(["set_type", "reps", "rest"]), ["rest"])).toEqual([
      "reps",
      "load",
      "rest",
    ]);
    // Rest unticked before: a preset with Rest doesn't add it.
    expect(presetColumns("endurance", new Set(["set_type", "reps"]), ["rest"])).toEqual([
      "set_type",
      "distance",
      "duration",
      "pace",
      "heart_rate_zone",
    ]);
  });
});

describe("presetOf", () => {
  it("names the preset a list is exactly, whatever its order, and null otherwise", () => {
    expect(presetOf(["rest", "rpe", "load", "reps", "set_type"])).toBe("strength");
    expect(presetOf(COLUMN_PRESET_FIELDS.erg)).toBe("erg");
    expect(presetOf(["reps", "load", "rest"])).toBeNull();
    expect(presetOf(["set_type", "reps", "load", "rpe", "rest", "tempo"])).toBeNull();
  });
});
