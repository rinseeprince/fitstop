import { supabaseAdmin } from "./supabase-admin";
import type {
  TrainingExercise,
  UpdateExerciseRequest,
  AddExerciseRequest,
} from "@/types/training";
import type { TrainingExerciseUpdate } from "@/lib/database-helpers";
import { mapExerciseRow } from "./training-mappers";
import { resolveExercise } from "./exercise-catalog-service";

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

  const { data, error } = await supabaseAdmin
    .from("training_exercises")
    .insert({
      session_id: sessionId,
      name: exercise.name,
      exercise_id: exerciseId,
      order_index: nextOrderIndex,
      sets: exercise.sets,
      reps_min: exercise.repsMin || null,
      reps_max: exercise.repsMax || null,
      reps_target: exercise.repsTarget || null,
      rpe_target: exercise.rpeTarget || null,
      percentage_1rm: exercise.percentage1rm || null,
      tempo: exercise.tempo || null,
      rest_seconds: exercise.restSeconds || null,
      notes: exercise.notes || null,
      superset_group: exercise.supersetGroup || null,
      is_warmup: exercise.isWarmup || false,
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
