import { supabaseAdmin } from "./supabase-admin";
import type {
  TrainingExercise,
  UpdateExerciseRequest,
  AddExerciseRequest,
} from "@/types/training";
import type { TrainingExerciseUpdate } from "@/lib/database-helpers";
import { mapExerciseRow } from "./training-mappers";
import { resolveExercise } from "./exercise-catalog-service";
import { projectExerciseCompact } from "@/utils/exercise-set-specs";

// Update exercise
export const updateExercise = async (
  exerciseId: string,
  updates: UpdateExerciseRequest
): Promise<TrainingExercise> => {
  const updateData: Partial<TrainingExerciseUpdate> = { updated_at: new Date().toISOString() };

  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.sets !== undefined) updateData.sets = updates.sets;
  if (updates.repsMin !== undefined) updateData.reps_min = updates.repsMin;
  if (updates.repsMax !== undefined) updateData.reps_max = updates.repsMax;
  if (updates.repsTarget !== undefined) updateData.reps_target = updates.repsTarget;
  if (updates.rpeTarget !== undefined) updateData.rpe_target = updates.rpeTarget;
  if (updates.percentage1rm !== undefined) updateData.percentage_1rm = updates.percentage1rm;
  if (updates.tempo !== undefined) updateData.tempo = updates.tempo;
  if (updates.restSeconds !== undefined) updateData.rest_seconds = updates.restSeconds;
  if (updates.notes !== undefined) updateData.notes = updates.notes;
  if (updates.supersetGroup !== undefined) updateData.superset_group = updates.supersetGroup;
  if (updates.isWarmup !== undefined) updateData.is_warmup = updates.isWarmup;
  if (updates.videoUrl !== undefined) updateData.video_url = updates.videoUrl;
  if (updates.setSpecs !== undefined) {
    if (updates.setSpecs) {
      // set_specs is authoritative -> re-project the compact columns to match.
      const w = projectExerciseCompact({ setSpecs: updates.setSpecs, sets: updates.sets ?? 1 });
      updateData.set_specs = w.set_specs;
      updateData.sets = w.sets;
      updateData.reps_min = w.reps_min;
      updateData.reps_max = w.reps_max;
    } else {
      updateData.set_specs = null;
    }
  }

  const { data, error } = await supabaseAdmin
    .from("training_exercises")
    .update(updateData)
    .eq("id", exerciseId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update exercise: ${error.message}`);

  return mapExerciseRow(data);
};

// Add exercise to session
export const addExercise = async (
  sessionId: string,
  exercise: AddExerciseRequest,
  coachId: string
): Promise<TrainingExercise> => {
  // Get max order index from active exercises
  const { data: existingExercises } = await supabaseAdmin
    .from("training_exercises")
    .select("order_index")
    .eq("session_id", sessionId)
    .eq("is_active", true)
    .order("order_index", { ascending: false })
    .limit(1);

  const nextOrderIndex = existingExercises?.[0]?.order_index !== undefined
    ? existingExercises[0].order_index + 1
    : 0;

  // Resolve exercise name to catalog ID
  const exerciseId = await resolveExercise(exercise.name, coachId);
  const w = projectExerciseCompact(exercise);

  const { data, error } = await supabaseAdmin
    .from("training_exercises")
    .insert({
      session_id: sessionId,
      name: exercise.name,
      exercise_id: exerciseId,
      order_index: nextOrderIndex,
      sets: w.sets,
      reps_min: w.reps_min,
      reps_max: w.reps_max,
      reps_target: exercise.repsTarget || null,
      rpe_target: exercise.rpeTarget || null,
      percentage_1rm: exercise.percentage1rm || null,
      tempo: exercise.tempo || null,
      rest_seconds: exercise.restSeconds || null,
      notes: exercise.notes || null,
      superset_group: exercise.supersetGroup || null,
      is_warmup: exercise.isWarmup || false,
      set_specs: w.set_specs,
      video_url: w.video_url,
      prescribed_fields: w.prescribed_fields,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to add exercise: ${error.message}`);

  return mapExerciseRow(data);
};

// Soft-delete exercise
export const deleteExercise = async (exerciseId: string): Promise<void> => {
  const { error } = await supabaseAdmin
    .from("training_exercises")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", exerciseId);

  if (error) throw new Error(`Failed to delete exercise: ${error.message}`);
};
