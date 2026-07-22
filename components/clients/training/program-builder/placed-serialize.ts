import type { z } from "zod";
import type { replaceSessionSchema } from "@/lib/validations/training";
import type { TrainingSession } from "@/types/training";
import { exerciseDraftToInput } from "./program-builder-serialize";
import {
  newUid,
  type ExerciseDraft,
  type SessionDraft,
} from "./program-builder-types";

// Serialization boundary between PLACED client rows (training_sessions /
// training_exercises) and the builder's draft model. The tray reads a placed
// session into a SessionDraft and writes it back through the replace PUT;
// Job 2's amendment surface extends this file with whole-plan reads/writes.

export type PlacedSessionPayload = z.infer<typeof replaceSessionSchema>;

/**
 * Clone a placed TrainingSession into an editable SessionDraft — fresh uids,
 * undefined→null coercions, `[]` setSpecs normalized to null (an empty array
 * fails the ≥1-non-warmup zod refine and would 400 the save), catalog
 * exerciseId preserved. `sessionType` is synthesized: training_sessions has
 * no session_type column. `exerciseIdByUid` maps each draft exercise uid back
 * to its training_exercises ROW id (not the catalog id) — unused by the tray
 * (the replace PUT is insert-fresh), needed by Job 2's amendment mapping.
 */
export function trainingSessionToDraft(s: TrainingSession): {
  draft: SessionDraft;
  exerciseIdByUid: Map<string, string>;
} {
  const exerciseIdByUid = new Map<string, string>();
  const exercises: ExerciseDraft[] = s.exercises.map((e) => {
    const uid = newUid("ex");
    exerciseIdByUid.set(uid, e.id);
    return {
      uid,
      exerciseId: e.exerciseId ?? null,
      name: e.name,
      setSpecs: e.setSpecs && e.setSpecs.length > 0 ? e.setSpecs : null,
      sets: e.sets,
      repsMin: e.repsMin ?? null,
      repsMax: e.repsMax ?? null,
      repsTarget: e.repsTarget ?? null,
      rpeTarget: e.rpeTarget ?? null,
      percentage1rm: e.percentage1rm ?? null,
      tempo: e.tempo ?? null,
      restSeconds: e.restSeconds ?? null,
      supersetGroup: e.supersetGroup ?? null,
      isWarmup: e.isWarmup,
      notes: e.notes ?? null,
      videoUrl: e.videoUrl ?? null,
    };
  });

  return {
    draft: {
      uid: newUid("sess"),
      name: s.name,
      focus: s.focus ?? null,
      estimatedDurationMinutes: s.estimatedDurationMinutes ?? null,
      // Placed surplus is ABSOLUTE (owner decision 10): the placed row carries
      // the resolved value — there is no stored plan default to inherit, so
      // null here means "no surplus", not "inherit".
      calorieSurplusPercentage: s.calorieSurplusPercentage ?? null,
      notes: s.notes ?? null,
      sessionType: "training",
      exercises,
    },
    exerciseIdByUid,
  };
}

/**
 * Serialize one SessionDraft into the replace-session PUT body. Reuses the
 * shared exerciseDraftToInput so per-set specs and video URLs survive verbatim
 * on this path exactly as they do on the library/inline paths.
 */
export function sessionDraftToPlacedPayload(
  session: SessionDraft,
): PlacedSessionPayload {
  return {
    name: session.name.slice(0, 100),
    focus: session.focus,
    estimatedDurationMinutes: session.estimatedDurationMinutes,
    calorieSurplusPercentage: session.calorieSurplusPercentage,
    notes: session.notes,
    exercises: session.exercises.map(exerciseDraftToInput),
  };
}
