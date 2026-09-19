"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { SET_TYPES, type SetType } from "@/utils/exercise-set-specs";
import {
  applySetSpecEdit,
  type SetSpecEdit,
} from "@/utils/set-spec-edits";
import type { ExerciseDraft } from "./program-builder-types";

// Per-exercise set-spec editing: a thin hook adapter over the pure kernel in
// utils/set-spec-edits.ts (extracted in builder S6a so the AI assistant's
// server-side tool executors share the exact same edit semantics — the two
// sides must never drift). `SetSpecEdit` is re-exported for the editor components.

export type { SetSpecEdit };

/** Each set type's word in the Type menu — a Record, so a type can't go unlabelled. */
const SET_TYPE_LABELS: Record<SetType, string> = {
  warmup: "Warm-up",
  working: "Working",
  drop: "Drop",
  failure: "Failure",
};

/** The set types in authoring order for the set-type select: the one list, labelled. */
export const SET_TYPE_OPTIONS: ReadonlyArray<{ value: SetType; label: string }> =
  SET_TYPES.map((value) => ({ value, label: SET_TYPE_LABELS[value] }));

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

  return useCallback(
    (sessionUid: string, exercise: ExerciseDraft, edit: SetSpecEdit) => {
      const result = applySetSpecEdit(exercise, edit);
      if (!result.ok) {
        toast.error(result.reason);
        return;
      }
      if (result.exercise === exercise) return; // no-op: don't dirty
      updateExercise(sessionUid, exercise.uid, () => result.exercise);
    },
    [updateExercise],
  );
}
