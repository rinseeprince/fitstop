import { describe, it, expect } from "vitest";
import {
  countWorkingSets,
  compactFromSpecs,
  expandSetSpecs,
  projectExerciseCompact,
  setSpecCount,
  type SetSpec,
  SET_SPEC_MEASURES,
  SET_SPEC_MEASURE_KEYS,
  specRange,
  specMeasures,
  isTempo,
  loadTypeBounds,
} from "./exercise-set-specs";
import { setSpecsArraySchema } from "@/lib/validations/training";

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

  it("returns 0 for an all-warmup exercise (authoring forbids an all-warmup list)", () => {
    expect(countWorkingSets([spec("warmup", 1), spec("warmup", 2)], 4)).toBe(0);
  });

  it("treats a spec missing set_type as non-warmup", () => {
    const specs = [{ set_number: 1 }, spec("warmup", 2)] as unknown;
    expect(countWorkingSets(specs, 9)).toBe(1);
  });
});

describe("compactFromSpecs", () => {
  it("counts working sets (warmups excluded) and spans the reps range", () => {
    const specs: SetSpec[] = [
      { set_number: 1, set_type: "warmup", reps_min: 12, reps_max: 15 },
      { set_number: 2, set_type: "working", reps_min: 6, reps_max: 8 },
      { set_number: 3, set_type: "working", reps_min: 5, reps_max: 10 },
      { set_number: 4, set_type: "drop" },
    ];
    expect(compactFromSpecs(specs)).toEqual({ sets: 3, repsMin: 5, repsMax: 10 });
  });

  it("clamps sets to the training_exercises CHECK [1, 20]", () => {
    const many: SetSpec[] = Array.from({ length: 25 }, (_, i) => ({
      set_number: i + 1,
      set_type: "working",
    }));
    expect(compactFromSpecs(many).sets).toBe(20);
    // All-warmup floors to 1 defensively (schema forbids it at authoring).
    expect(compactFromSpecs([{ set_number: 1, set_type: "warmup" }]).sets).toBe(1);
  });
});

describe("expandSetSpecs", () => {
  it("returns the authored specs verbatim when present", () => {
    const authored: SetSpec[] = [{ set_number: 1, set_type: "amrap", reps_min: 5 }];
    expect(expandSetSpecs({ setSpecs: authored, sets: 3 })).toBe(authored);
  });

  it("synthesizes N working specs from the compact columns when specs are absent", () => {
    const out = expandSetSpecs({ setSpecs: null, sets: 3, repsMin: 8, repsMax: 12, percentage1rm: 75 });
    expect(out).toHaveLength(3);
    expect(out.every((s) => s.set_type === "working")).toBe(true);
    expect(out[0]).toMatchObject({ reps_min: 8, reps_max: 12, load_type: "pct_1rm", load_min: 75, load_max: 75 });
  });
});

describe("setSpecCount", () => {
  it("is the length expandSetSpecs returns, warm-ups included, without building the list", () => {
    const authored: SetSpec[] = [spec("warmup", 1), spec("working", 2), spec("drop", 3)];
    for (const exercise of [
      { setSpecs: authored, sets: 2 },
      { setSpecs: null, sets: 4 },
      { setSpecs: [], sets: 3 },
      { setSpecs: null, sets: 99 },
      { setSpecs: null, sets: 0 },
    ]) {
      expect(setSpecCount(exercise)).toBe(expandSetSpecs(exercise).length);
    }
    expect(setSpecCount({ setSpecs: authored, sets: 2 })).toBe(3);
    // The compact count clamps like the training_exercises.sets CHECK.
    expect(setSpecCount({ setSpecs: null, sets: 99 })).toBe(20);
    expect(setSpecCount({ setSpecs: null, sets: 0 })).toBe(1);
  });
});

describe("projectExerciseCompact (INPUT write-site contract)", () => {
  it("writes set_specs verbatim + re-derives compact columns from specs", () => {
    const specs: SetSpec[] = [
      { set_number: 1, set_type: "warmup" },
      { set_number: 2, set_type: "working", reps_min: 6, reps_max: 8 },
      { set_number: 3, set_type: "working", reps_min: 6, reps_max: 10 },
    ];
    const w = projectExerciseCompact({ setSpecs: specs, videoUrl: "https://v/x", sets: 99, prescribedFields: ["reps", "load"] });
    expect(w.set_specs).toBe(specs);
    expect(w.video_url).toBe("https://v/x");
    expect(w.sets).toBe(2); // compact projection wins over the stale `sets: 99`
    expect(w.reps_min).toBe(6);
    expect(w.reps_max).toBe(10);
  });

  it("passes compact columns through untouched when no specs are supplied", () => {
    const w = projectExerciseCompact({ setSpecs: null, sets: 4, repsMin: 5, repsMax: 5, prescribedFields: ["reps"] });
    expect(w.set_specs).toBeNull();
    expect(w.video_url).toBeNull();
    expect(w).toMatchObject({ sets: 4, reps_min: 5, reps_max: 5 });
  });
});

describe("setSpecsArraySchema (authoring guard)", () => {
  it("rejects an all-warmup array", () => {
    const r = setSpecsArraySchema.safeParse([
      { set_number: 1, set_type: "warmup" },
      { set_number: 2, set_type: "warmup" },
    ]);
    expect(r.success).toBe(false);
  });

  it("accepts an array with at least one working set", () => {
    const r = setSpecsArraySchema.safeParse([
      { set_number: 1, set_type: "warmup" },
      { set_number: 2, set_type: "working", reps_min: 6, reps_max: 8 },
    ]);
    expect(r.success).toBe(true);
  });
});

describe("the measures table (migration 183)", () => {
  it("names every numeric target as a min/max pair with the owner's bounds", () => {
    expect(SET_SPEC_MEASURE_KEYS).toEqual([
      "reps", "load", "rpe", "rir", "distance", "duration", "pace", "split", "calories",
      "cadence", "stroke_rate", "resistance", "heart_rate_zone", "heart_rate", "power", "ftp_percent",
    ]);
    for (const measure of SET_SPEC_MEASURE_KEYS) {
      const keys = SET_SPEC_MEASURES[measure];
      expect(keys.min.endsWith("_min")).toBe(true);
      expect(keys.max.endsWith("_max")).toBe(true);
      expect(keys.floor).toBeLessThan(keys.ceiling);
    }
    expect(SET_SPEC_MEASURES.rpe).toMatchObject({ floor: 1, ceiling: 10 });
    expect(SET_SPEC_MEASURES.distance).toMatchObject({ min: "distance_meters_min", ceiling: 1_000_000 });
    expect(SET_SPEC_MEASURES.pace).toMatchObject({ min: "pace_seconds_per_km_min", floor: 60, ceiling: 3600 });
    expect(SET_SPEC_MEASURES.split).toMatchObject({ min: "split_seconds_per_500m_min", floor: 30, ceiling: 600 });
  });

  it("reads a spec's pairs by measure and lists the measures it carries", () => {
    const spec: SetSpec = {
      set_number: 1,
      set_type: "working",
      rpe_min: 7,
      rpe_max: 8,
      distance_meters_min: 5000,
      distance_meters_max: null,
    };
    expect(specRange(spec, "rpe")).toEqual({ min: 7, max: 8 });
    expect(specRange(spec, "distance")).toEqual({ min: 5000, max: null });
    expect(specRange(spec, "power")).toEqual({ min: null, max: null });
    expect(specMeasures(spec)).toEqual(["rpe", "distance"]);
  });

  it("tempo is four phases, seconds or X", () => {
    for (const ok of ["3-1-X-0", "0-0-0-0", "31-1-X-X", "X-X-X-X"]) expect(isTempo(ok)).toBe(true);
    for (const bad of ["3010", "3-1-X", "3-1-x-0", "100-1-1-1", "3-1-X-0-", "", null, 3]) {
      expect(isTempo(bad)).toBe(false);
    }
  });

  it("a load's bounds follow its type", () => {
    expect(loadTypeBounds("absolute")).toMatchObject({ floor: 0, ceiling: 2000 });
    expect(loadTypeBounds("pct_1rm")).toMatchObject({ floor: 0, ceiling: 100 });
    expect(loadTypeBounds("pct_top").ceiling).toBe(100);
  });
});

describe("expandSetSpecs synthesizes pairs from the compact columns", () => {
  it("puts the exercise-level RPE and % 1RM at both ends", () => {
    const [spec] = expandSetSpecs({ setSpecs: null, sets: 1, rpeTarget: 8, percentage1rm: 75 });
    expect(spec).toMatchObject({
      load_type: "pct_1rm",
      load_min: 75,
      load_max: 75,
      rpe_min: 8,
      rpe_max: 8,
    });
    expect(spec).not.toHaveProperty("rpe_target");
    expect(spec).not.toHaveProperty("load_value");
  });
});

describe("projectExerciseCompact narrows the column list", () => {
  it("keeps every known column and drops an unknown one, never emitting an empty list", () => {
    expect(
      projectExerciseCompact({ setSpecs: null, sets: 3, prescribedFields: ["distance", "pace", "weight"] })
        .prescribed_fields,
    ).toEqual(["distance", "pace"]);
    expect(
      projectExerciseCompact({ setSpecs: null, sets: 3, prescribedFields: [] }).prescribed_fields,
    ).toEqual(["set_type", "reps", "load", "rpe", "rest"]);
  });
});
