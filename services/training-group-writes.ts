import { supabaseAdmin } from "./supabase-admin";
import type {
  TrainingExerciseGroupInsert,
  TrainingExerciseInsert,
} from "@/lib/database-helpers";
import type { Json } from "@/types/database";
import {
  projectExerciseCompact,
  type SetSpec,
} from "@/utils/exercise-set-specs";
import {
  groupSettingsToRow,
  type GroupSettings,
  type GroupSettingsInput,
} from "@/utils/exercise-groups";
import { toPrescribedFields } from "@/utils/prescribed-fields";

// Every write of a client session's exercises goes through here: the groups
// first, then the exercises that sit in them (migration 178 — an exercise's
// foreign key names its group, and its session). Group ids are minted before
// anything is written, so every exercise row names its group up front and no
// row is matched back from RETURNING, whose order Postgres does not promise.
// Positions are array places: a group's order_index is its place in the
// session, an exercise's its place in its group.
//
// Two builders, because a copy and an authoring write are different acts
// (CONVENTIONS section 8, training prescription model): an authoring write
// re-projects the compact columns from set_specs through projectExerciseCompact;
// a copy carries every column of its source as it is.

/** Rows per INSERT statement: a placement can clone thousands of exercises. */
const INSERT_CHUNK = 500;

/** A client session's groups and exercises as rows, groups first. */
type TrainingGroupRows = {
  groups: TrainingExerciseGroupInsert[];
  exercises: TrainingExerciseInsert[];
};

/** One exercise of an authoring write (the tray's save, a clone with edits). */
export type TrainingExerciseWrite = {
  name: string;
  exerciseId?: string | null;
  sets: number;
  repsMin?: number | null;
  repsMax?: number | null;
  repsTarget?: string | null;
  rpeTarget?: number | null;
  percentage1rm?: number | null;
  tempo?: string | null;
  restSeconds?: number | null;
  notes?: string | null;
  isWarmup?: boolean;
  setSpecs?: SetSpec[] | null;
  videoUrl?: string | null;
  prescribedFields?: readonly string[] | null;
};

export type TrainingGroupWrite = GroupSettingsInput & { exercises: TrainingExerciseWrite[] };

/**
 * One exercise being copied — a library exercise on its way to a client
 * (placement) or a client exercise to another client session (the tray's
 * clone). Every prescription column is carried as it is.
 */
type CopiedExercise = {
  exerciseId?: string | null;
  name: string;
  sets: number;
  repsMin?: number | null;
  repsMax?: number | null;
  repsTarget?: string | null;
  rpeTarget?: number | null;
  percentage1rm?: number | null;
  tempo?: string | null;
  restSeconds?: number | null;
  notes?: string | null;
  isWarmup?: boolean;
  setSpecs?: SetSpec[] | null;
  videoUrl?: string | null;
  prescribedFields?: readonly string[] | null;
};

type CopiedGroup = GroupSettings & { exercises: readonly CopiedExercise[] };

/**
 * The rows of an authoring write. An explicit `exerciseId` wins; otherwise the
 * name resolves through the caller's catalog lookup.
 */
export function trainingGroupRowsFromInput(
  sessionId: string,
  groups: readonly TrainingGroupWrite[],
  exerciseIdMap: Map<string, string>,
): TrainingGroupRows {
  const rows: TrainingGroupRows = { groups: [], exercises: [] };
  groups.forEach((group, groupIndex) => {
    const groupId = crypto.randomUUID();
    rows.groups.push({
      id: groupId,
      session_id: sessionId,
      order_index: groupIndex,
      ...groupSettingsToRow(group),
    });
    group.exercises.forEach((ex, exerciseIndex) => {
      const w = projectExerciseCompact(ex);
      rows.exercises.push({
        session_id: sessionId,
        group_id: groupId,
        name: ex.name,
        // Explicit id wins; otherwise fall back to the name-resolved catalog id.
        // Writing a bare `ex.exerciseId ?? null` here is what left 574
        // training_exercises rows with a NULL catalog link.
        exercise_id: ex.exerciseId ?? exerciseIdMap.get(ex.name.trim()) ?? null,
        order_index: exerciseIndex,
        sets: w.sets,
        reps_min: w.reps_min,
        reps_max: w.reps_max,
        reps_target: ex.repsTarget ?? null,
        rpe_target: ex.rpeTarget ?? null,
        percentage_1rm: ex.percentage1rm ?? null,
        tempo: ex.tempo ?? null,
        rest_seconds: ex.restSeconds ?? null,
        notes: ex.notes ?? null,
        is_warmup: ex.isWarmup ?? false,
        set_specs: w.set_specs,
        video_url: w.video_url,
        prescribed_fields: w.prescribed_fields,
        is_active: true,
      });
    });
  });
  return rows;
}

/** The rows of a copy: every group setting and exercise column carried as it is. */
export function trainingGroupRowsFromCopy(
  sessionId: string,
  groups: readonly CopiedGroup[],
): TrainingGroupRows {
  const rows: TrainingGroupRows = { groups: [], exercises: [] };
  groups.forEach((group, groupIndex) => {
    const groupId = crypto.randomUUID();
    rows.groups.push({
      id: groupId,
      session_id: sessionId,
      order_index: groupIndex,
      ...groupSettingsToRow(group),
    });
    group.exercises.forEach((ex, exerciseIndex) => {
      rows.exercises.push({
        session_id: sessionId,
        group_id: groupId,
        name: ex.name,
        exercise_id: ex.exerciseId ?? null,
        order_index: exerciseIndex,
        sets: ex.sets,
        reps_min: ex.repsMin ?? null,
        reps_max: ex.repsMax ?? null,
        reps_target: ex.repsTarget ?? null,
        rpe_target: ex.rpeTarget ?? null,
        percentage_1rm: ex.percentage1rm ?? null,
        tempo: ex.tempo ?? null,
        rest_seconds: ex.restSeconds ?? null,
        notes: ex.notes ?? null,
        is_warmup: ex.isWarmup ?? false,
        set_specs: (ex.setSpecs ?? null) as unknown as Json,
        video_url: ex.videoUrl ?? null,
        prescribed_fields: toPrescribedFields(ex.prescribedFields),
        is_active: true,
      });
    });
  });
  return rows;
}

/** Merge several sessions' rows into one pair of batches. */
export function concatTrainingGroupRows(parts: readonly TrainingGroupRows[]): TrainingGroupRows {
  return {
    groups: parts.flatMap((part) => part.groups),
    exercises: parts.flatMap((part) => part.exercises),
  };
}

/**
 * Write client group rows: the groups, then their exercises, chunked. Not a
 * transaction — a failure between the two leaves groups with no exercises,
 * which no reader sees (a group is read through its exercises) and which every
 * caller's own recovery removes with the session they belong to.
 */
export async function insertTrainingGroupRows(rows: TrainingGroupRows): Promise<void> {
  for (let from = 0; from < rows.groups.length; from += INSERT_CHUNK) {
    const { error } = await supabaseAdmin
      .from("training_exercise_groups")
      .insert(rows.groups.slice(from, from + INSERT_CHUNK));
    if (error) throw new Error(`Failed to insert exercise groups: ${error.message}`);
  }
  for (let from = 0; from < rows.exercises.length; from += INSERT_CHUNK) {
    const { error } = await supabaseAdmin
      .from("training_exercises")
      .insert(rows.exercises.slice(from, from + INSERT_CHUNK));
    if (error) throw new Error(`Failed to insert exercises: ${error.message}`);
  }
}
