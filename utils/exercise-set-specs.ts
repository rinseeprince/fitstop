// Per-set prescription model (Training Builder S1, migration 119).
//
// A prescription exercise can carry an authoritative per-set list (`set_specs`
// JSONB on coach_saved_exercises / training_exercises). When it is absent the
// compact columns (`sets` / `reps_min` / `reps_max`) remain the source of truth
// (expand-on-read). In Phase 1 nothing authors `set_specs` yet, so this file
// ships only the read-side primitive the analytics needs; the log-form
// expansion (`expandSetSpecs`) and the clamped insert-side compact projection
// (`compactFromSpecs`, which must satisfy the training_exercises CHECK [1,20])
// arrive with their consumers in Phase 2.

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
 * Read-side only. The insert-side compact projection that must clamp to the
 * `training_exercises.sets` CHECK is a separate Phase 2 helper.
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
