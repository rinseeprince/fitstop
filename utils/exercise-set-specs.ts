import type { Json } from "@/types/database";
import { LOAD_KG_MAX } from "@/lib/constants";
import { toPrescribedFields, type PrescribedField } from "./prescribed-fields";

// Per-set prescription model (Training Builder S1, migration 119; ranges and
// every measurement column since migration 183).
//
// A prescription exercise can carry an authoritative per-set list (`set_specs`
// JSONB on coach_saved_exercises / training_exercises). When it is absent the
// compact columns (`sets` / `reps_min` / `reps_max`) remain the source of truth
// (expand-on-read).
//
// `set_specs` IS authored today — the program builder writes it, and
// `set_logs.set_type` is seeded from it at log time. When specs exist the
// compact columns are a MAINTAINED PROJECTION, never independent truth:
// `projectExerciseCompact` re-derives them via `compactFromSpecs` (clamped to
// the `training_exercises.sets` CHECK [1,20]) on every input-side write, while
// clone sites splat the source row's columns verbatim. Writing the compact
// three by hand silently corrupts a coach's programming.

export type SetType = "warmup" | "working" | "amrap" | "drop" | "failure";

export type LoadType = "absolute" | "pct_1rm" | "pct_top";

/**
 * Every numeric target a set can carry, each stored as a `<key>_min` /
 * `<key>_max` pair (a single value is min === max) with the bounds the owner
 * set (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md §4.4 "Limits"). Units are the
 * canonical storage units (CONVENTIONS §20): metres, seconds, seconds per km,
 * seconds per 500 m, kilograms for an absolute load. The spec keys, the zod
 * schema and the flattened rows all derive from this table, so a measure is
 * added here once.
 */
export const SET_SPEC_MEASURES = {
  reps: { min: "reps_min", max: "reps_max", floor: 0, ceiling: 100, integer: true },
  // Kilograms or a percentage, by the set's load_type; the ceiling is the
  // kilogram one, and a percentage is bounded again by loadTypeBounds.
  load: { min: "load_min", max: "load_max", floor: 0, ceiling: LOAD_KG_MAX, integer: false },
  rpe: { min: "rpe_min", max: "rpe_max", floor: 1, ceiling: 10, integer: false },
  rir: { min: "rir_min", max: "rir_max", floor: 0, ceiling: 10, integer: false },
  distance: { min: "distance_meters_min", max: "distance_meters_max", floor: 1, ceiling: 1_000_000, integer: false },
  duration: { min: "duration_seconds_min", max: "duration_seconds_max", floor: 0.1, ceiling: 86_400, integer: false },
  pace: { min: "pace_seconds_per_km_min", max: "pace_seconds_per_km_max", floor: 60, ceiling: 3_600, integer: true },
  split: { min: "split_seconds_per_500m_min", max: "split_seconds_per_500m_max", floor: 30, ceiling: 600, integer: false },
  calories: { min: "calories_min", max: "calories_max", floor: 1, ceiling: 5_000, integer: true },
  cadence: { min: "cadence_min", max: "cadence_max", floor: 1, ceiling: 300, integer: true },
  stroke_rate: { min: "stroke_rate_min", max: "stroke_rate_max", floor: 1, ceiling: 150, integer: true },
  resistance: { min: "resistance_min", max: "resistance_max", floor: 0, ceiling: 100, integer: false },
  heart_rate_zone: { min: "heart_rate_zone_min", max: "heart_rate_zone_max", floor: 1, ceiling: 5, integer: true },
  heart_rate: { min: "heart_rate_min", max: "heart_rate_max", floor: 30, ceiling: 250, integer: true },
  power: { min: "power_min", max: "power_max", floor: 1, ceiling: 3_000, integer: true },
  ftp_percent: { min: "ftp_percent_min", max: "ftp_percent_max", floor: 1, ceiling: 300, integer: false },
} as const;

export type SetSpecMeasure = keyof typeof SET_SPEC_MEASURES;
export const SET_SPEC_MEASURE_KEYS = Object.keys(SET_SPEC_MEASURES) as SetSpecMeasure[];

type MeasureKeys = (typeof SET_SPEC_MEASURES)[SetSpecMeasure]["min" | "max"];
type MeasurePairs = { [K in MeasureKeys]?: number | null };

/** The percentage load types' own ceiling; an absolute load takes the kilogram one. */
export const LOAD_PERCENT_MAX = 100;

/** The bounds a load value is clamped to, by its type. */
export function loadTypeBounds(loadType: LoadType | null | undefined): {
  floor: number;
  ceiling: number;
  integer: boolean;
} {
  return loadType === "absolute" || loadType == null
    ? { floor: 0, ceiling: LOAD_KG_MAX, integer: false }
    : { floor: 0, ceiling: LOAD_PERCENT_MAX, integer: false };
}

/**
 * Tempo is ONE compound value: four phases, each seconds (0–99) or X for
 * explosive, written "3-1-X-0". The same grammar on every path that stores a
 * tempo — a set's, and the exercise-level summary column.
 */
export const TEMPO_PATTERN = /^(?:\d{1,2}|X)-(?:\d{1,2}|X)-(?:\d{1,2}|X)-(?:\d{1,2}|X)$/;

export function isTempo(value: unknown): value is string {
  return typeof value === "string" && TEMPO_PATTERN.test(value);
}

export type SetSpec = MeasurePairs & {
  set_number: number;
  set_type: SetType;
  // No longer authored per set (the builder's writer went with the disabled
  // amrap/failure reps input; the assistant's went in the 2026-08 sweep). It is
  // populated only by `expandSetSpecs` / `snapshotToSpecs` from the LIVE
  // exercise-level `training_exercises.reps_target` column for compact-only
  // exercises, and rendered by set-row / the coach readout — retire it WITH that
  // column, not before.
  reps_target?: string | null;
  // The unit of load_min / load_max: kilograms, or a percentage of 1RM or of
  // the top set. Null means no load is prescribed.
  load_type?: LoadType | null;
  tempo?: string | null;
  // One number: it is what the rest timer counts down.
  rest_seconds?: number | null;
  // A drop carries ONE load value and one rep count; the load TYPE belongs to
  // the parent spec, so every drop of one set is expressed in the same unit.
  // Mixing units inside one drop set ("80kg, drop to 60%") is not a performable
  // prescription, and giving each drop its own type would make that state
  // representable.
  //
  // `weight` is the pre-load_value spelling — canonical kilograms, from when a
  // drop could only be absolute. Reads go through `dropLoadValue` below; writes
  // emit `load_value` only. The key stays on the type because removing it is a
  // destructive change that needs a prod probe, not a dev one (CONVENTIONS §8).
  drops?:
    | { load_value?: number | null; weight?: number | null; reps: number | null }[]
    | null;
};

/** A measure's stored pair on one spec, read through the table. */
export function specRange(
  spec: SetSpec,
  measure: SetSpecMeasure,
): { min: number | null; max: number | null } {
  const keys = SET_SPEC_MEASURES[measure];
  return { min: spec[keys.min] ?? null, max: spec[keys.max] ?? null };
}

/** The measures a spec carries a value for (either end of the pair set). */
export function specMeasures(spec: SetSpec): SetSpecMeasure[] {
  return SET_SPEC_MEASURE_KEYS.filter((measure) => {
    const { min, max } = specRange(spec, measure);
    return min != null || max != null;
  });
}

/**
 * A drop's prescribed load value, honouring the legacy `weight` spelling.
 *
 * One accessor so no reader has to remember the fallback — the same reason
 * `snapshotToSpecs` exists rather than each caller expanding a snapshot itself.
 */
export function dropLoadValue(drop: {
  load_value?: number | null;
  weight?: number | null;
}): number | null {
  return drop.load_value ?? drop.weight ?? null;
}

/**
 * Count the sets that count toward volume/compliance — every set type except
 * `warmup`. Reads the authoritative per-set list when present; when `setSpecs`
 * is absent or not a usable array, falls back to `fallbackSets` (the compact
 * `sets` count, which historically counted working sets since warm-ups lived as
 * a separate `is_warmup` exercise).
 *
 * Accepts `unknown` because callers pass a JSONB value (e.g. a prescribed
 * snapshot's `set_specs`). A spec missing an explicit `set_type` counts as
 * non-warmup (matching the analytics default of `'working'`).
 *
 * Read-side only. The insert-side compact projection that clamps to the
 * `training_exercises.sets` CHECK is `compactFromSpecs` below.
 */
export function countWorkingSets(setSpecs: unknown, fallbackSets: number): number {
  if (!Array.isArray(setSpecs) || setSpecs.length === 0) return fallbackSets;
  let count = 0;
  for (const spec of setSpecs) {
    if (
      spec &&
      typeof spec === "object" &&
      (spec as { set_type?: unknown }).set_type !== "warmup"
    ) {
      count += 1;
    }
  }
  return count;
}

// Authoring ceilings shared by the builder editors and the progression engine.
// MAX_SET_SPECS mirrors setSpecsArraySchema's .max(30); MAX_WORKING_SETS names
// the training_exercises.sets CHECK bound [1, 20] the compact projection
// clamps to.
export const MAX_SET_SPECS = 30;
export const MAX_WORKING_SETS = 20;

const clamp = (n: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, n));

/**
 * Insert-side compact projection (Phase 2). `set_specs` is authoritative, but the
 * compact columns (`sets` / `reps_min` / `reps_max`) stay a MAINTAINED PROJECTION
 * so the legacy readers that never learn about `set_specs` still show a truthful
 * prescription. `sets` counts working (non-warmup) sets and CLAMPS to the
 * `training_exercises.sets` CHECK [1, 20]; the reps range spans the working specs.
 * Authoring validation forbids an all-warmup array (`setSpecsArraySchema`), so the
 * clamp-to-1 floor here is defensive, not a real authored state.
 */
export function compactFromSpecs(specs: SetSpec[]): {
  sets: number;
  repsMin: number | null;
  repsMax: number | null;
} {
  const working = specs.filter((s) => s.set_type !== "warmup");
  const sets = clamp(working.length, 1, MAX_WORKING_SETS);
  let repsMin: number | null = null;
  let repsMax: number | null = null;
  for (const s of working) {
    if (s.reps_min != null) {
      repsMin = repsMin == null ? s.reps_min : Math.min(repsMin, s.reps_min);
    }
    if (s.reps_max != null) {
      repsMax = repsMax == null ? s.reps_max : Math.max(repsMax, s.reps_max);
    }
  }
  return { sets, repsMin, repsMax };
}

/**
 * How many sets an exercise prescribes, warm-ups and finishers included: its
 * authored specs, else its compact set count — the length `expandSetSpecs`
 * returns, without building the list. A drop set's drops belong to their set.
 * In a superset or circuit this is the exercise's number of rounds.
 */
export function setSpecCount(ex: {
  setSpecs?: readonly unknown[] | null;
  sets: number;
}): number {
  if (Array.isArray(ex.setSpecs) && ex.setSpecs.length > 0) return ex.setSpecs.length;
  return clamp(Math.floor(ex.sets ?? 1), 1, MAX_WORKING_SETS);
}

/**
 * Log-form / snapshot seeding (Phase 2). Returns the authored per-set list when
 * present; otherwise synthesizes N `working` specs from the compact columns so
 * every prescription yields per-set rows carrying a `set_type`. The compact
 * columns hold one number each, so a synthesized pair is that number at both
 * ends. The client log form seeds its row COUNT + warm-up labels from this; the
 * client still enters the actual values. `set_type` is coach-prescribed, never
 * chosen by the client.
 */
export function expandSetSpecs(ex: {
  setSpecs?: SetSpec[] | null;
  sets: number;
  repsMin?: number | null;
  repsMax?: number | null;
  repsTarget?: string | null;
  rpeTarget?: number | null;
  percentage1rm?: number | null;
  tempo?: string | null;
  restSeconds?: number | null;
}): SetSpec[] {
  if (Array.isArray(ex.setSpecs) && ex.setSpecs.length > 0) return ex.setSpecs;
  const n = setSpecCount(ex);
  return Array.from({ length: n }, (_, i) => ({
    set_number: i + 1,
    set_type: "working" as const,
    reps_min: ex.repsMin ?? null,
    reps_max: ex.repsMax ?? null,
    reps_target: ex.repsTarget ?? null,
    load_type: ex.percentage1rm != null ? ("pct_1rm" as const) : null,
    load_min: ex.percentage1rm ?? null,
    load_max: ex.percentage1rm ?? null,
    rpe_min: ex.rpeTarget ?? null,
    rpe_max: ex.rpeTarget ?? null,
    tempo: ex.tempo ?? null,
    rest_seconds: ex.restSeconds ?? null,
    drops: null,
  }));
}

/**
 * The snake_case sibling of `expandSetSpecs`: expand a prescribed exercise
 * SNAPSHOT (a fresh one, or a preserved `prescribed_exercise_snapshot` JSONB
 * record) into per-set specs. It sits here rather than in its own module because
 * it asks no new question — a snapshot is a prescription written down at log
 * time, so this is that function with a key adapter in front of it.
 *
 * Every reader of a logged set's prescription goes through it, so the coach's
 * readout cannot describe a different prescription from the one
 * `set_logs.set_type` was stamped against.
 */
export function snapshotToSpecs(
  snap: Record<string, unknown> | null,
): SetSpec[] {
  if (!snap) return [];
  return expandSetSpecs({
    setSpecs: (snap.set_specs as SetSpec[] | null) ?? null,
    sets: typeof snap.sets === "number" ? snap.sets : 1,
    repsMin: (snap.reps_min as number | null) ?? null,
    repsMax: (snap.reps_max as number | null) ?? null,
    repsTarget: (snap.reps_target as string | null) ?? null,
    rpeTarget: (snap.rpe_target as number | null) ?? null,
    percentage1rm: (snap.percentage_1rm as number | null) ?? null,
    tempo: (snap.tempo as string | null) ?? null,
    restSeconds: (snap.rest_seconds as number | null) ?? null,
  });
}

/**
 * Insert-side projection for an INPUT (authoring) write. Returns the DB column
 * values for the fields the set model touches: `set_specs` / `video_url` are
 * written verbatim, the compact `sets` / `reps_min` / `reps_max` are re-derived
 * from `set_specs` (via compactFromSpecs) whenever specs are present so they stay a
 * maintained projection, and `prescribed_fields` is the column list narrowed to
 * the known names. Every INPUT clone/insert site routes through this so no
 * path silently drops per-set data (Landmine #2). CLONE sites that copy an existing
 * row splat `set_specs` / `video_url` verbatim instead (the compact columns are
 * already correct on the source row).
 */
export function projectExerciseCompact(input: {
  setSpecs?: SetSpec[] | null;
  videoUrl?: string | null;
  prescribedFields: readonly string[];
  sets: number;
  repsMin?: number | null;
  repsMax?: number | null;
}): {
  sets: number;
  reps_min: number | null;
  reps_max: number | null;
  set_specs: Json | null;
  video_url: string | null;
  prescribed_fields: PrescribedField[];
} {
  const specs =
    input.setSpecs && input.setSpecs.length > 0 ? input.setSpecs : null;
  const compact = specs ? compactFromSpecs(specs) : null;
  return {
    sets: compact ? compact.sets : input.sets,
    reps_min: compact ? compact.repsMin : input.repsMin ?? null,
    reps_max: compact ? compact.repsMax : input.repsMax ?? null,
    set_specs: (specs ?? null) as unknown as Json | null,
    video_url: input.videoUrl ?? null,
    // Migration 183: required, never null and never []. Every INPUT site routes
    // through here so none of them can drop the column (Landmine #2, same
    // reason set_specs does).
    prescribed_fields: toPrescribedFields(input.prescribedFields),
  };
}
