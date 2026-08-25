import type { ExerciseDraft } from "./program-builder-types";

// Shared prescription summary for the builder. It prefers the maintained
// compact reps range over an exercise-level repsTarget once per-set specs
// exist (per-set edits re-project the range but never the target, so the
// target would show stale reps after editing sets).

// Dense "sets×reps" for session cards (mockup `.ex-s`): "3×8-12", "4×8" (a
// single number when min===max or only one bound is set), or "3 sets" when no
// reps are set. Hyphen + collapsed, matching the reference.
export function setsRepsShort(e: ExerciseDraft): string {
  const range =
    e.repsMin != null && e.repsMax != null
      ? e.repsMin === e.repsMax
        ? `${e.repsMin}`
        : `${e.repsMin}-${e.repsMax}`
      : e.repsMin != null
        ? `${e.repsMin}`
        : e.repsMax != null
          ? `${e.repsMax}`
          : null;
  const reps =
    e.setSpecs && e.setSpecs.length > 0
      ? range ?? e.repsTarget
      : e.repsTarget ?? range;
  return reps ? `${e.sets}×${reps}` : `${e.sets} sets`;
}
