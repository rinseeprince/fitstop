import { supabaseAdmin } from "./supabase-admin";
import type {
  TrainingSession,
  UpdateSessionRequest,
} from "@/types/training";
import type { TrainingSessionUpdate } from "@/lib/database-helpers";
import { mapExerciseRow, mapSessionRow } from "./training-mappers";
import { resolveExercises } from "./exercise-catalog-service";
import { projectExerciseCompact } from "@/utils/exercise-set-specs";
import type { SetSpec } from "@/utils/exercise-set-specs";

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
  setSpecs?: SetSpec[] | null;
  videoUrl?: string | null;
};

/**
 * Catalog ids for the exercises that arrived without one, keyed by name.
 *
 * An explicit `exerciseId` from the caller always wins; only unresolved names
 * are looked up, so an already-linked prescription never mints a duplicate
 * catalog row. Same shape as coach-standalone-session-service.ts:97 and
 * coach-saved-plan-service.ts:46.
 */
async function resolveMissingExerciseIds(
  exercises: ExerciseInput[],
  coachId: string,
): Promise<Map<string, string>> {
  const unresolvedNames = exercises.filter((e) => !e.exerciseId).map((e) => e.name);
  if (unresolvedNames.length === 0) return new Map();
  return resolveExercises(unresolvedNames, coachId);
}

function buildExerciseInserts(
  sessionId: string,
  exercises: ExerciseInput[],
  exerciseIdMap: Map<string, string>,
) {
  return exercises.map((ex) => {
    const w = projectExerciseCompact(ex);
    return {
      session_id: sessionId,
      name: ex.name,
      // Explicit id wins; otherwise fall back to the name-resolved catalog id.
      // Writing a bare `ex.exerciseId ?? null` here is what left 574
      // training_exercises rows with a NULL catalog link.
      exercise_id: ex.exerciseId ?? exerciseIdMap.get(ex.name) ?? null,
      order_index: ex.orderIndex,
      sets: w.sets,
      reps_min: w.reps_min,
      reps_max: w.reps_max,
      reps_target: ex.repsTarget ?? null,
      rpe_target: ex.rpeTarget ?? null,
      percentage_1rm: ex.percentage1rm ?? null,
      tempo: ex.tempo ?? null,
      rest_seconds: ex.restSeconds ?? null,
      notes: ex.notes ?? null,
      superset_group: ex.supersetGroup ?? null,
      is_warmup: ex.isWarmup ?? false,
      set_specs: w.set_specs,
      video_url: w.video_url,
      is_active: true,
    };
  });
}

// Clone a session and reassign a specific event to the clone.
// If exerciseOverrides is provided, use those instead of cloning the originals.
export async function cloneSessionForEvent(
  sessionId: string,
  eventId: string,
  clientId: string,
  coachId: string,
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
      week_index: session.week_index,
      is_rest: session.is_rest,
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
      const exerciseIdMap = await resolveMissingExerciseIds(exerciseOverrides, coachId);
      const inserts = buildExerciseInserts(clonedSession.id, exerciseOverrides, exerciseIdMap);
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
        set_specs: ex.set_specs ?? null,
        video_url: ex.video_url ?? null,
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
  exercises: ExerciseInput[],
  coachId: string,
  clientId: string
): Promise<void> {
  // Verify the session belongs to a plan owned by this client (session -> plan
  // -> client_id), mirroring cloneSessionForEvent. Defense in depth on top of
  // the route's session-belongs-to-plan check: this service is service-role and
  // must never trust a bare sessionId, or a foreign sessionId would be wiped.
  const { data: ownedSession } = await supabaseAdmin
    .from("training_sessions")
    .select("id, training_plans!inner(client_id)")
    .eq("id", sessionId)
    .eq("training_plans.client_id", clientId)
    .maybeSingle();

  if (!ownedSession) {
    throw new Error("Session not found");
  }

  // Soft-delete existing exercises
  const { error: deleteError } = await supabaseAdmin
    .from("training_exercises")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("session_id", sessionId)
    .eq("is_active", true);

  if (deleteError) throw new Error(`Failed to deactivate exercises: ${deleteError.message}`);

  // Insert new exercises
  if (exercises.length > 0) {
    const exerciseIdMap = await resolveMissingExerciseIds(exercises, coachId);
    const inserts = buildExerciseInserts(sessionId, exercises, exerciseIdMap);
    const { error: insertError } = await supabaseAdmin.from("training_exercises").insert(inserts);
    if (insertError) throw new Error(`Failed to insert exercises: ${insertError.message}`);
  }
}
