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
import type { Json } from "@/types/database";

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
  if (updates.calorieSurplusPercentage !== undefined)
    updateData.calorie_surplus_percentage = updates.calorieSurplusPercentage;

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

/**
 * Propagate a session's new calorie_surplus_percentage to all of its future
 * scheduled training_events. Mirrors the "all future" pattern used by
 * moveEventAndFuture in training-event-calendar-service.ts.
 *
 * Also sets is_modified=true so the regeneration pathway doesn't overwrite
 * the coach's deliberate edit.
 *
 * Returns the count of event rows updated (useful for the caller to know if
 * a nutrition cascade is worth triggering).
 */
export async function updateSurplusForFutureEvents(
  sessionId: string,
  surplus: number | null,
  fromDate: string,
): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("training_events")
    .update({
      calorie_surplus_percentage: surplus,
      is_modified: true,
      updated_at: new Date().toISOString(),
    })
    .eq("training_session_id", sessionId)
    .gte("date", fromDate)
    .eq("status", "scheduled")
    .select("id");

  if (error) throw new Error(`Failed to update future event surpluses: ${error.message}`);

  return data?.length ?? 0;
}

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
      day_of_week: session.dayOfWeek ?? null,
      order_index: nextOrderIndex,
      focus: session.focus ?? null,
      notes: session.notes ?? null,
      estimated_duration_minutes: session.estimatedDurationMinutes ?? null,
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

// Exercise input shape for bulk operations
export type ExerciseInput = {
  name: string;
  sets: number;
  orderIndex: number;
  exerciseId?: string | null;
  repsMin?: number | null;
  repsMax?: number | null;
  repsTarget?: string | null;
  rpeTarget?: number | null;
  restSeconds?: number | null;
  tempo?: string | null;
  percentage1rm?: number | null;
  supersetGroup?: string | null;
  isWarmup?: boolean;
  notes?: string | null;
};

function buildExerciseInserts(sessionId: string, exercises: ExerciseInput[]) {
  return exercises.map((ex) => ({
    session_id: sessionId,
    name: ex.name,
    exercise_id: ex.exerciseId ?? null,
    order_index: ex.orderIndex,
    sets: ex.sets,
    reps_min: ex.repsMin ?? null,
    reps_max: ex.repsMax ?? null,
    reps_target: ex.repsTarget ?? null,
    rpe_target: ex.rpeTarget ?? null,
    percentage_1rm: ex.percentage1rm ?? null,
    tempo: ex.tempo ?? null,
    rest_seconds: ex.restSeconds ?? null,
    notes: ex.notes ?? null,
    superset_group: ex.supersetGroup ?? null,
    is_warmup: ex.isWarmup ?? false,
    is_active: true,
  }));
}

// Clone a session and reassign a specific event to the clone.
// If exerciseOverrides is provided, use those instead of cloning the originals.
export async function cloneSessionForEvent(
  sessionId: string,
  eventId: string,
  clientId: string,
  exerciseOverrides?: ExerciseInput[]
): Promise<string> {
  // 0. Verify the target event belongs to this client BEFORE doing any work, so a
  //    foreign eventId can't repoint another client's scheduled event (and so the
  //    attack path doesn't leave an orphan cloned session).
  const { data: targetEvent } = await supabaseAdmin
    .from("training_events")
    .select("id")
    .eq("id", eventId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (!targetEvent) {
    throw new Error("Event not found");
  }

  // 1. Fetch source session, scoped to this client (session -> plan -> client_id)
  //    so a sessionId from another client/plan can't be cloned.
  const { data: session, error: sessionError } = await supabaseAdmin
    .from("training_sessions")
    .select("*, training_plans!inner(client_id)")
    .eq("id", sessionId)
    .eq("is_active", true)
    .eq("training_plans.client_id", clientId)
    .maybeSingle();

  if (sessionError || !session) {
    throw new Error("Session not found");
  }

  // 2. Clone session
  const { data: clonedSession, error: cloneError } = await supabaseAdmin
    .from("training_sessions")
    .insert({
      plan_id: session.plan_id,
      name: session.name,
      day_of_week: null,
      order_index: session.order_index,
      focus: session.focus,
      notes: session.notes,
      estimated_duration_minutes: session.estimated_duration_minutes,
      estimated_calories: session.estimated_calories,
      calories_calculated_at: session.calories_calculated_at,
      calorie_surplus_percentage: session.calorie_surplus_percentage,
      is_active: true,
    })
    .select("id")
    .single();

  if (cloneError || !clonedSession) {
    throw new Error(`Failed to clone session: ${cloneError?.message}`);
  }

  // 3. Insert exercises (overrides or cloned from original)
  if (exerciseOverrides) {
    if (exerciseOverrides.length > 0) {
      const inserts = buildExerciseInserts(clonedSession.id, exerciseOverrides);
      const { error: exError } = await supabaseAdmin.from("training_exercises").insert(inserts);
      if (exError) throw new Error(`Failed to insert exercises: ${exError.message}`);
    }
  } else {
    const { data: exercises } = await supabaseAdmin
      .from("training_exercises")
      .select("*")
      .eq("session_id", sessionId)
      .eq("is_active", true)
      .order("order_index", { ascending: true });

    if (exercises && exercises.length > 0) {
      const exerciseInserts = exercises.map((ex) => ({
        session_id: clonedSession.id,
        name: ex.name,
        exercise_id: ex.exercise_id,
        order_index: ex.order_index,
        sets: ex.sets,
        reps_min: ex.reps_min,
        reps_max: ex.reps_max,
        reps_target: ex.reps_target,
        rpe_target: ex.rpe_target,
        percentage_1rm: ex.percentage_1rm,
        tempo: ex.tempo,
        rest_seconds: ex.rest_seconds,
        notes: ex.notes,
        superset_group: ex.superset_group,
        is_warmup: ex.is_warmup as boolean,
        is_active: true,
      }));
      const { error: exError } = await supabaseAdmin.from("training_exercises").insert(exerciseInserts);
      if (exError) throw new Error(`Failed to clone exercises: ${exError.message}`);
    }
  }

  // 4. Update event to point to cloned session — scoped to this client (defense
  //    in depth on top of the step-0 ownership check).
  const { error: eventError } = await supabaseAdmin
    .from("training_events")
    .update({
      training_session_id: clonedSession.id,
      is_modified: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", eventId)
    .eq("client_id", clientId);

  if (eventError) throw new Error(`Failed to update event: ${eventError.message}`);

  return clonedSession.id;
}

// Bulk replace all exercises for a session (soft-delete old, insert new)
export async function bulkReplaceExercises(
  sessionId: string,
  exercises: ExerciseInput[]
): Promise<void> {
  // Soft-delete existing exercises
  const { error: deleteError } = await supabaseAdmin
    .from("training_exercises")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("session_id", sessionId)
    .eq("is_active", true);

  if (deleteError) throw new Error(`Failed to deactivate exercises: ${deleteError.message}`);

  // Insert new exercises
  if (exercises.length > 0) {
    const inserts = buildExerciseInserts(sessionId, exercises);
    const { error: insertError } = await supabaseAdmin.from("training_exercises").insert(inserts);
    if (insertError) throw new Error(`Failed to insert exercises: ${insertError.message}`);
  }
}
