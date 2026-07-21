import type { Json } from "@/types/database";

// Per-set prescription model (Training Builder S1, migration 119).
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

export type SetSpec = {
  set_number: number;
  set_type: SetType;
  reps_min?: number | null;
  reps_max?: number | null;
  reps_target?: string | null;
  load_type?: "absolute" | "pct_1rm" | "pct_top" | null;
  load_value?: number | null;
  rpe_target?: number | null;
  tempo?: string | null;
  rest_seconds?: number | null;
  drops?: { weight: number | null; reps: number | null }[] | null;
};

/**
 * Count the sets that count toward volume/compliance — every set type except
 * `warmup`. Reads the authoritative per-set list when present; when `setSpecs`
 * is absent (the Phase 1 state — nothing authors it yet) or not a usable array,
 * falls back to `fallbackSets` (the compact `sets` count, which historically
 * counted working sets since warm-ups lived as a separate `is_warmup` exercise).
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
 * Log-form / snapshot seeding (Phase 2). Returns the authored per-set list when
 * present; otherwise synthesizes N `working` specs from the compact columns so
 * every prescription yields per-set rows carrying a `set_type`. The client log
 * form seeds its row COUNT + warm-up labels from this; the client still enters
 * the actual values. `set_type` is coach-prescribed, never chosen by the client.
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
  const n = clamp(Math.floor(ex.sets ?? 1), 1, MAX_WORKING_SETS);
  return Array.from({ length: n }, (_, i) => ({
    set_number: i + 1,
    set_type: "working" as const,
    reps_min: ex.repsMin ?? null,
    reps_max: ex.repsMax ?? null,
    reps_target: ex.repsTarget ?? null,
    load_type: ex.percentage1rm != null ? ("pct_1rm" as const) : null,
    load_value: ex.percentage1rm ?? null,
    rpe_target: ex.rpeTarget ?? null,
    tempo: ex.tempo ?? null,
    rest_seconds: ex.restSeconds ?? null,
    drops: null,
  }));
}

/**
 * Insert-side projection for an INPUT (authoring) write. Returns the DB column
 * values for the five fields the set model touches: `set_specs` / `video_url` are
 * written verbatim, and the compact `sets` / `reps_min` / `reps_max` are re-derived
 * from `set_specs` (via compactFromSpecs) whenever specs are present so they stay a
 * maintained projection. Every INPUT clone/insert site routes through this so no
 * path silently drops per-set data (Landmine #2). CLONE sites that copy an existing
 * row splat `set_specs` / `video_url` verbatim instead (the compact columns are
 * already correct on the source row).
 */
export function projectExerciseCompact(input: {
  setSpecs?: SetSpec[] | null;
  videoUrl?: string | null;
  sets: number;
  repsMin?: number | null;
  repsMax?: number | null;
}): {
  sets: number;
  reps_min: number | null;
  reps_max: number | null;
  set_specs: Json | null;
  video_url: string | null;
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
  };
}
