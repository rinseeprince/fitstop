import {
  compactFromSpecs,
  expandSetSpecs,
  MAX_SET_SPECS,
  type SetSpec,
} from "./exercise-set-specs";

// Pure per-exercise set-spec editing kernel (extracted from the "use client"
// use-set-spec-mutations.ts in builder S6a so the assistant's server-side tool
// executors can share it). Invariants enforced here (mirroring
// setSpecsArraySchema so the server can never 400 on them): ≤30 specs,
// ≤20 drops per set, and never all-warmup — EXCEPT that deleting the very last
// set reverts setSpecs to null entirely (the exercise falls back to its
// compact columns; [] never survives). Every accepted edit re-projects the
// compact columns via compactFromSpecs so the collapsed summary and legacy
// readers stay truthful (landmine #2).
//
// Structurally typed (like progression-rules.ts) — utils must not import
// component types; the builder's ExerciseDraft satisfies SpecEditableExercise
// with no cast.

export const MAX_DROPS = 20;

export type SpecEditableExercise = {
  setSpecs: SetSpec[] | null;
  sets: number;
  repsMin: number | null;
  repsMax: number | null;
  repsTarget?: string | null;
  rpeTarget?: number | null;
  percentage1rm?: number | null;
  tempo?: string | null;
  restSeconds?: number | null;
};

export type SetSpecEdit =
  | { kind: "add-set"; afterIndex?: number }
  | { kind: "remove-set"; index: number }
  | { kind: "update-set"; index: number; patch: Partial<SetSpec> }
  | { kind: "add-drop"; setIndex: number }
  | { kind: "remove-drop"; setIndex: number; dropIndex: number }
  | {
      kind: "update-drop";
      setIndex: number;
      dropIndex: number;
      // `load_value` is expressed in the PARENT spec's load_type. `weight` is
      // the pre-load_value spelling, still accepted so a legacy caller keeps
      // working; nothing writes it any more.
      patch: {
        load_value?: number | null;
        weight?: number | null;
        reps?: number | null;
      };
    };

export type SetSpecEditResult<T extends SpecEditableExercise> =
  | { ok: true; exercise: T }
  | { ok: false; reason: string };

const cloneSpec = (s: SetSpec): SetSpec => ({
  ...s,
  drops: s.drops ? s.drops.map((d) => ({ ...d })) : s.drops,
});

const hasNonWarmup = (specs: SetSpec[]): boolean =>
  specs.some((s) => s.set_type !== "warmup");

function editSpecs(specs: SetSpec[], edit: SetSpecEdit): SetSpec[] | { reason: string } {
  switch (edit.kind) {
    case "add-set": {
      if (specs.length >= MAX_SET_SPECS) {
        return { reason: `Maximum ${MAX_SET_SPECS} sets per exercise` };
      }
      const after = edit.afterIndex ?? specs.length - 1;
      const template = specs[after] ?? specs[specs.length - 1];
      const next = [...specs];
      next.splice(after + 1, 0, cloneSpec(template));
      return next;
    }
    case "remove-set": {
      const next = specs.filter((_, i) => i !== edit.index);
      // Removing the final set is allowed — the caller reverts to null/compact.
      if (next.length > 0 && !hasNonWarmup(next)) {
        return { reason: "At least one working set is required" };
      }
      return next;
    }
    case "update-set": {
      const target = specs[edit.index];
      if (!target) return specs;
      // Blur-without-change commits must stay no-ops: returning the same
      // array reference lets applySetSpecEdit skip materialization + dirty.
      if (
        Object.entries(edit.patch).every(
          ([key, value]) => target[key as keyof SetSpec] === value,
        )
      ) {
        return specs;
      }
      const updated: SetSpec = { ...target, ...edit.patch };
      // Drops only make sense on drop sets; changing type away clears them.
      if (edit.patch.set_type && edit.patch.set_type !== "drop") {
        updated.drops = null;
      }
      const next = specs.map((s, i) => (i === edit.index ? updated : s));
      if (!hasNonWarmup(next)) {
        return { reason: "At least one working set is required" };
      }
      return next;
    }
    case "add-drop": {
      const target = specs[edit.setIndex];
      if (!target) return specs;
      const drops = target.drops ?? [];
      if (drops.length >= MAX_DROPS) {
        return { reason: `Maximum ${MAX_DROPS} drops per set` };
      }
      return specs.map((s, i) =>
        i === edit.setIndex
          ? { ...s, drops: [...drops, { weight: null, reps: null }] }
          : s,
      );
    }
    case "remove-drop": {
      const target = specs[edit.setIndex];
      if (!target?.drops) return specs;
      const drops = target.drops.filter((_, i) => i !== edit.dropIndex);
      return specs.map((s, i) =>
        i === edit.setIndex ? { ...s, drops: drops.length ? drops : null } : s,
      );
    }
    case "update-drop": {
      const target = specs[edit.setIndex];
      if (!target?.drops) return specs;
      return specs.map((s, i) =>
        i === edit.setIndex
          ? {
              ...s,
              drops: target.drops!.map((d, j) =>
                j === edit.dropIndex
                  ? // A drop carries ONE load value. Writing `load_value` drops
                    // the legacy `weight` off the row rather than leaving two
                    // keys that can disagree about the same number.
                    edit.patch.load_value !== undefined
                    ? { ...d, weight: undefined, ...edit.patch }
                    : { ...d, ...edit.patch }
                  : d,
              ),
            }
          : s,
      );
    }
  }
}

/**
 * Apply one per-set edit to an exercise. Materializes setSpecs from the
 * compact columns on first touch (expandSetSpecs), renumbers set_number, and
 * re-projects the compact sets/repsMin/repsMax.
 */
export function applySetSpecEdit<T extends SpecEditableExercise>(
  exercise: T,
  edit: SetSpecEdit,
): SetSpecEditResult<T> {
  const specs = exercise.setSpecs ?? expandSetSpecs(exercise);
  const result = editSpecs(specs, edit);
  if (!Array.isArray(result)) return { ok: false, reason: result.reason };

  // No-op edit: return the exercise untouched — in particular, don't
  // materialize specs for a compact-only exercise on a blur that changed
  // nothing (that would silently switch its saved shape).
  if (result === specs) return { ok: true, exercise };

  if (result.length === 0) {
    // Last set deleted → back to null; keep the last compact projection.
    return { ok: true, exercise: { ...exercise, setSpecs: null } };
  }

  const renumbered = result.map((s, i) => ({ ...s, set_number: i + 1 }));
  const compact = compactFromSpecs(renumbered);
  return {
    ok: true,
    exercise: {
      ...exercise,
      setSpecs: renumbered,
      sets: compact.sets,
      repsMin: compact.repsMin,
      repsMax: compact.repsMax,
    },
  };
}
