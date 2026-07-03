"use client";

import { useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  compactFromSpecs,
  expandSetSpecs,
  MAX_SET_SPECS,
  type SetSpec,
  type SetType,
} from "@/utils/exercise-set-specs";
import type { ExerciseDraft } from "./program-builder-types";

// Per-exercise set-spec editing kernel. Pure function + a thin hook adapter.
// Invariants enforced here (mirroring setSpecsArraySchema so the server can
// never 400 on them): ≤30 specs, ≤20 drops per set, and never all-warmup —
// EXCEPT that deleting the very last set reverts setSpecs to null entirely
// (the exercise falls back to its compact columns; [] never survives).
// Every accepted edit re-projects the compact columns via compactFromSpecs so
// the collapsed summary and legacy readers stay truthful (landmine #2).

// MAX_SET_SPECS moved to utils/exercise-set-specs.ts (the progression engine
// needs it and can't import a "use client" module); re-exported so existing
// importers keep working.
export { MAX_SET_SPECS };
export const MAX_DROPS = 20;

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
      patch: { weight?: number | null; reps?: number | null };
    };

export type SetSpecEditResult =
  | { ok: true; exercise: ExerciseDraft }
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
                j === edit.dropIndex ? { ...d, ...edit.patch } : d,
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
export function applySetSpecEdit(
  exercise: ExerciseDraft,
  edit: SetSpecEdit,
): SetSpecEditResult {
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

/** Set types in authoring order for the set-type select. */
export const SET_TYPE_OPTIONS: Array<{ value: SetType; label: string }> = [
  { value: "warmup", label: "Warm-up" },
  { value: "working", label: "Working" },
  { value: "amrap", label: "AMRAP" },
  { value: "drop", label: "Drop" },
  { value: "failure", label: "Failure" },
];

/**
 * Hook adapter: applies an edit to the RENDERED exercise (the parent-owned
 * draft is the single source of truth, so the prop is current), surfaces
 * rejections as a toast, and commits accepted results through updateExercise.
 * Deliberately not computed inside the state updater — reducers must stay
 * side-effect free (StrictMode double-invokes them).
 */
export function useSetSpecMutations(
  updateExercise: (
    sessionUid: string,
    exerciseUid: string,
    fn: (e: ExerciseDraft) => ExerciseDraft,
  ) => void,
) {
  const { toast } = useToast();

  return useCallback(
    (sessionUid: string, exercise: ExerciseDraft, edit: SetSpecEdit) => {
      const result = applySetSpecEdit(exercise, edit);
      if (!result.ok) {
        toast({ title: result.reason, variant: "destructive" });
        return;
      }
      if (result.exercise === exercise) return; // no-op: don't dirty
      updateExercise(sessionUid, exercise.uid, () => result.exercise);
    },
    [updateExercise, toast],
  );
}
