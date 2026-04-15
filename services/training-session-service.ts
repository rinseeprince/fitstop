import { supabaseAdmin } from "./supabase-admin";
import type {
  TrainingSession,
  TrainingExercise,
  UpdateSessionRequest,
  AddSessionRequest,
  AddExerciseRequest,
  AIGeneratedSession,
  ReorderSessionItem,
} from "@/types/training";
import type { TrainingSessionUpdate } from "@/lib/database-helpers";
import { mapExerciseRow, mapSessionRow } from "./training-mappers";
import { resolveExercises } from "./exercise-catalog-service";

// Update session
export const updateSession = async (
  sessionId: string,
  updates: UpdateSessionRequest
): Promise<TrainingSession> => {
  const updateData: Partial<TrainingSessionUpdate> = { updated_at: new Date().toISOString() };

  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.dayOfWeek !== undefined) updateData.day_of_week = updates.dayOfWeek;
  if (updates.orderIndex !== undefined) updateData.order_index = updates.orderIndex;
  if (updates.focus !== undefined) updateData.focus = updates.focus;
  if (updates.notes !== undefined) updateData.notes = updates.notes;
  if (updates.estimatedDurationMinutes !== undefined)
    updateData.estimated_duration_minutes = updates.estimatedDurationMinutes;

  const { data, error } = await supabaseAdmin
    .from("training_sessions")
    .update(updateData)
    .eq("id", sessionId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update session: ${error.message}`);

  const { data: exercises } = await supabaseAdmin
    .from("training_exercises")
    .select("*")
    .eq("session_id", sessionId)
    .eq("is_active", true)
    .order("order_index", { ascending: true });

  return mapSessionRow(data, (exercises || []).map(mapExerciseRow));
};

// Add session to plan
export const addSession = async (
  planId: string,
  session: AddSessionRequest
): Promise<TrainingSession> => {
  // Get max order index from active sessions
  const { data: existingSessions } = await supabaseAdmin
    .from("training_sessions")
    .select("order_index")
    .eq("plan_id", planId)
    .eq("is_active", true)
    .order("order_index", { ascending: false })
    .limit(1);

  const nextOrderIndex = existingSessions?.[0]?.order_index !== undefined
    ? existingSessions[0].order_index + 1
    : 0;

  const { data, error } = await supabaseAdmin
    .from("training_sessions")
    .insert({
      plan_id: planId,
      name: session.name,
      day_of_week: session.dayOfWeek || null,
      order_index: nextOrderIndex,
      focus: session.focus || null,
      notes: session.notes || null,
      estimated_duration_minutes: session.estimatedDurationMinutes || null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to add session: ${error.message}`);

  return mapSessionRow(data, []);
};

// Soft-delete session (and its exercises)
export const deleteSession = async (sessionId: string): Promise<void> => {
  const { error } = await supabaseAdmin
    .from("training_sessions")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", sessionId);

  if (error) throw new Error(`Failed to delete session: ${error.message}`);

  // Also soft-delete child exercises
  await supabaseAdmin
    .from("training_exercises")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("session_id", sessionId);
};

// Replace all exercises for a session
export const replaceSessionExercises = async (
  sessionId: string,
  exercises: AddExerciseRequest[],
  coachId: string
): Promise<TrainingExercise[]> => {
  // Soft-delete existing exercises
  const { error: deactivateError } = await supabaseAdmin
    .from("training_exercises")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("session_id", sessionId)
    .eq("is_active", true);

  if (deactivateError) throw new Error(`Failed to deactivate existing exercises: ${deactivateError.message}`);

  // Resolve exercise names to catalog IDs
  const exerciseNames = exercises.map((e) => e.name);
  const resolvedMap = await resolveExercises(exerciseNames, coachId);

  // Insert new exercises
  const newExercises: TrainingExercise[] = [];
  for (let i = 0; i < exercises.length; i++) {
    const exercise = exercises[i];
    const { data, error } = await supabaseAdmin
      .from("training_exercises")
      .insert({
        session_id: sessionId,
        name: exercise.name,
        exercise_id: resolvedMap.get(exercise.name.trim()) ?? null,
        order_index: i,
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

    if (error) throw new Error(`Failed to insert exercise: ${error.message}`);
    newExercises.push(mapExerciseRow(data));
  }

  return newExercises;
};

// Get session with exercises by ID
export const getSessionWithExercises = async (
  sessionId: string
): Promise<TrainingSession | null> => {
  const { data: sessionRow, error: sessionError } = await supabaseAdmin
    .from("training_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("is_active", true)
    .single();

  if (sessionError || !sessionRow) return null;

  const { data: exerciseRows } = await supabaseAdmin
    .from("training_exercises")
    .select("*")
    .eq("session_id", sessionId)
    .eq("is_active", true)
    .order("order_index", { ascending: true });

  return mapSessionRow(
    sessionRow,
    (exerciseRows || []).map(mapExerciseRow)
  );
};

// Insert sessions and exercises for an existing plan row
export const insertTrainingSessions = async (
  planId: string,
  sessions: AIGeneratedSession[],
  coachId: string
): Promise<TrainingSession[]> => {
  // Collect all exercise names across sessions for batch resolution
  const allExerciseNames = sessions.flatMap((s) =>
    s.exercises.map((e) => e.name)
  );
  const resolvedMap = await resolveExercises(allExerciseNames, coachId);

  const result: TrainingSession[] = [];

  for (let i = 0; i < sessions.length; i++) {
    const sessionData = sessions[i];

    const { data: sessionRow, error: sessionError } = await supabaseAdmin
      .from("training_sessions")
      .insert({
        plan_id: planId,
        name: sessionData.name,
        day_of_week: sessionData.dayOfWeek || null,
        order_index: i,
        focus: sessionData.focus || null,
        notes: sessionData.notes || null,
        estimated_duration_minutes: sessionData.estimatedDurationMinutes || null,
      })
      .select()
      .single();

    if (sessionError || !sessionRow) throw new Error(`Failed to create session: ${sessionError?.message || "No data returned"}`);

    const exercises: TrainingExercise[] = [];

    for (let j = 0; j < sessionData.exercises.length; j++) {
      const exerciseData = sessionData.exercises[j];

      const { data: exerciseRow, error: exerciseError } = await supabaseAdmin
        .from("training_exercises")
        .insert({
          session_id: sessionRow.id,
          name: exerciseData.name,
          exercise_id: resolvedMap.get(exerciseData.name.trim()) ?? null,
          order_index: j,
          sets: exerciseData.sets,
          reps_min: exerciseData.repsMin || null,
          reps_max: exerciseData.repsMax || null,
          reps_target: exerciseData.repsTarget || null,
          rpe_target: exerciseData.rpeTarget || null,
          percentage_1rm: exerciseData.percentage1rm || null,
          tempo: exerciseData.tempo || null,
          rest_seconds: exerciseData.restSeconds || null,
          notes: exerciseData.notes || null,
          superset_group: exerciseData.supersetGroup || null,
          is_warmup: exerciseData.isWarmup || false,
        })
        .select()
        .single();

      if (exerciseError || !exerciseRow) throw new Error(`Failed to create exercise: ${exerciseError?.message || "No data returned"}`);

      exercises.push(mapExerciseRow(exerciseRow));
    }

    result.push(mapSessionRow(sessionRow, exercises));
  }

  return result;
};

// Bulk reorder sessions (update day and order in batch)
export const reorderSessions = async (
  planId: string,
  updates: ReorderSessionItem[]
): Promise<void> => {
  const timestamp = new Date().toISOString();

  // Update each session's day and order
  for (const update of updates) {
    const { error } = await supabaseAdmin
      .from("training_sessions")
      .update({
        day_of_week: update.dayOfWeek,
        order_index: update.orderIndex,
        updated_at: timestamp,
      })
      .eq("id", update.sessionId)
      .eq("plan_id", planId);

    if (error) {
      throw new Error(`Failed to reorder session ${update.sessionId}: ${error.message}`);
    }
  }
};

// Update session estimated calories
export const updateSessionCalories = async (
  sessionId: string,
  estimatedCalories: number
): Promise<void> => {
  const { error } = await supabaseAdmin
    .from("training_sessions")
    .update({
      estimated_calories: estimatedCalories,
      calories_calculated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  if (error) {
    throw new Error(`Failed to update session calories: ${error.message}`);
  }
};
