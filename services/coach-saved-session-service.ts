import { supabaseAdmin } from "./supabase-admin";
import { resolveExercises } from "./exercise-catalog-service";
import { projectExerciseCompact } from "@/utils/exercise-set-specs";
import type { SetSpec } from "@/utils/exercise-set-specs";
import { recomputePlanCycleInfo } from "./coach-library-helpers";

// PLAN-ATTACHED session + exercise CRUD. The standalone-session library
// (saved_plan_id NULL: create/get/duplicate/overwrite/dedup) lives in
// coach-standalone-session-service.ts.

// --- Session CRUD ---

export async function addSavedSession(
  planId: string,
  coachId: string,
  session: { name: string; focus?: string; isRest?: boolean; estimatedDurationMinutes?: number; calorieSurplusPercentage?: number; notes?: string; sessionType?: string }
): Promise<string> {
  // Verify plan ownership
  const { data: plan } = await supabaseAdmin
    .from("coach_saved_plans")
    .select("id")
    .eq("id", planId)
    .eq("coach_id", coachId)
    .single();
  if (!plan) throw new Error("Plan not found or access denied");

  // Get max order_index
  const { data: maxSession } = await supabaseAdmin
    .from("coach_saved_sessions")
    .select("order_index")
    .eq("saved_plan_id", planId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextIndex = (maxSession?.order_index ?? -1) + 1;

  const { data, error } = await supabaseAdmin
    .from("coach_saved_sessions")
    .insert({
      coach_id: coachId,
      saved_plan_id: planId,
      name: session.name,
      focus: session.focus ?? null,
      order_index: nextIndex,
      is_rest: session.isRest ?? false,
      estimated_duration_minutes: session.estimatedDurationMinutes ?? null,
      calorie_surplus_percentage: session.calorieSurplusPercentage ?? null,
      notes: session.notes ?? null,
      session_type: session.sessionType ?? "training",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Failed to add session: ${error?.message}`);

  await recomputePlanCycleInfo(planId, coachId);
  return data.id;
}

export async function updateSavedSession(
  sessionId: string,
  coachId: string,
  updates: {
    name?: string;
    focus?: string | null;
    isRest?: boolean;
    estimatedDurationMinutes?: number | null;
    calorieSurplusPercentage?: number | null;
    notes?: string | null;
    sessionType?: string;
  }
): Promise<void> {
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from("coach_saved_sessions")
    .select("saved_plan_id")
    .eq("id", sessionId)
    .eq("coach_id", coachId)
    .single();
  if (fetchError || !existing) throw new Error(`Session not found: ${fetchError?.message}`);

  const { error } = await supabaseAdmin
    .from("coach_saved_sessions")
    .update({
      ...(updates.name !== undefined && { name: updates.name }),
      ...(updates.focus !== undefined && { focus: updates.focus }),
      ...(updates.isRest !== undefined && { is_rest: updates.isRest }),
      ...(updates.estimatedDurationMinutes !== undefined && { estimated_duration_minutes: updates.estimatedDurationMinutes }),
      ...(updates.calorieSurplusPercentage !== undefined && { calorie_surplus_percentage: updates.calorieSurplusPercentage }),
      ...(updates.notes !== undefined && { notes: updates.notes }),
      ...(updates.sessionType !== undefined && { session_type: updates.sessionType }),
    })
    .eq("id", sessionId)
    .eq("coach_id", coachId);
  if (error) throw new Error(`Failed to update session: ${error.message}`);

  // Only recompute when is_rest changed — other field edits don't affect cycle info.
  if (updates.isRest !== undefined && existing.saved_plan_id) {
    await recomputePlanCycleInfo(existing.saved_plan_id, coachId);
  }
}

export async function removeSavedSession(sessionId: string, coachId: string): Promise<void> {
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from("coach_saved_sessions")
    .select("saved_plan_id")
    .eq("id", sessionId)
    .eq("coach_id", coachId)
    .single();
  if (fetchError || !existing) throw new Error(`Session not found: ${fetchError?.message}`);

  const { error } = await supabaseAdmin
    .from("coach_saved_sessions")
    .delete()
    .eq("id", sessionId)
    .eq("coach_id", coachId);
  if (error) throw new Error(`Failed to delete session: ${error.message}`);

  if (existing.saved_plan_id) {
    await recomputePlanCycleInfo(existing.saved_plan_id, coachId);
  }
}

export async function reorderSavedSessions(
  planId: string,
  coachId: string,
  order: Array<{ sessionId: string; orderIndex: number }>
): Promise<void> {
  // Verify plan ownership
  const { data: plan } = await supabaseAdmin
    .from("coach_saved_plans")
    .select("id")
    .eq("id", planId)
    .eq("coach_id", coachId)
    .single();
  if (!plan) throw new Error("Plan not found or access denied");

  for (const item of order) {
    await supabaseAdmin
      .from("coach_saved_sessions")
      .update({ order_index: item.orderIndex })
      .eq("id", item.sessionId)
      .eq("saved_plan_id", planId);
  }

  // Rest positions change when sessions are reordered; keep rest_pattern in sync.
  await recomputePlanCycleInfo(planId, coachId);
}

// --- Exercise CRUD ---

export async function addSavedExercise(
  sessionId: string,
  coachId: string,
  exercise: {
    name: string;
    sets: number;
    repsMin?: number | null;
    repsMax?: number | null;
    repsTarget?: string | null;
    rpeTarget?: number | null;
    percentage1rm?: number | null;
    tempo?: string | null;
    restSeconds?: number | null;
    supersetGroup?: string | null;
    isWarmup?: boolean;
    notes?: string | null;
    setSpecs?: SetSpec[] | null;
    videoUrl?: string | null;
  }
): Promise<string> {
  // Verify session ownership
  const { data: session } = await supabaseAdmin
    .from("coach_saved_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("coach_id", coachId)
    .single();
  if (!session) throw new Error("Session not found or access denied");

  // Resolve exercise name
  const exerciseIdMap = await resolveExercises([exercise.name], coachId);

  // Get max order_index
  const { data: maxEx } = await supabaseAdmin
    .from("coach_saved_exercises")
    .select("order_index")
    .eq("saved_session_id", sessionId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextIndex = (maxEx?.order_index ?? -1) + 1;
  const w = projectExerciseCompact(exercise);

  const { data, error } = await supabaseAdmin
    .from("coach_saved_exercises")
    .insert({
      saved_session_id: sessionId,
      exercise_id: exerciseIdMap.get(exercise.name.trim().toLowerCase()) ?? null,
      name: exercise.name,
      order_index: nextIndex,
      sets: w.sets,
      reps_min: w.reps_min,
      reps_max: w.reps_max,
      reps_target: exercise.repsTarget ?? null,
      rpe_target: exercise.rpeTarget ?? null,
      percentage_1rm: exercise.percentage1rm ?? null,
      tempo: exercise.tempo ?? null,
      rest_seconds: exercise.restSeconds ?? null,
      superset_group: exercise.supersetGroup ?? null,
      is_warmup: exercise.isWarmup ?? false,
      notes: exercise.notes ?? null,
      set_specs: w.set_specs,
      video_url: w.video_url,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Failed to add exercise: ${error?.message}`);
  return data.id;
}

export async function updateSavedExercise(
  exerciseId: string,
  coachId: string,
  updates: {
    name?: string;
    sets?: number;
    repsMin?: number | null;
    repsMax?: number | null;
    repsTarget?: string | null;
    rpeTarget?: number | null;
    percentage1rm?: number | null;
    tempo?: string | null;
    restSeconds?: number | null;
    supersetGroup?: string | null;
    isWarmup?: boolean;
    notes?: string | null;
    setSpecs?: SetSpec[] | null;
    videoUrl?: string | null;
  }
): Promise<void> {
  // Verify ownership via session
  const { data: exercise } = await supabaseAdmin
    .from("coach_saved_exercises")
    .select("saved_session_id")
    .eq("id", exerciseId)
    .single();
  if (!exercise) throw new Error("Exercise not found");

  const { data: session } = await supabaseAdmin
    .from("coach_saved_sessions")
    .select("id")
    .eq("id", exercise.saved_session_id)
    .eq("coach_id", coachId)
    .single();
  if (!session) throw new Error("Access denied");

  // If name changed, re-resolve exercise_id
  let exerciseIdUpdate: { exercise_id?: string | null } = {};
  if (updates.name !== undefined) {
    const idMap = await resolveExercises([updates.name], coachId);
    exerciseIdUpdate = { exercise_id: idMap.get(updates.name.trim().toLowerCase()) ?? null };
  }

  // When set_specs changes to a real list, re-derive the compact projection so
  // the columns stay in sync; a null clears set_specs and honors explicit compact.
  const specProj = updates.setSpecs
    ? projectExerciseCompact({ setSpecs: updates.setSpecs, sets: updates.sets ?? 1 })
    : null;

  const { error } = await supabaseAdmin
    .from("coach_saved_exercises")
    .update({
      ...exerciseIdUpdate,
      ...(updates.name !== undefined && { name: updates.name }),
      ...(specProj
        ? { sets: specProj.sets }
        : updates.sets !== undefined
          ? { sets: updates.sets }
          : {}),
      ...(specProj
        ? { reps_min: specProj.reps_min }
        : updates.repsMin !== undefined
          ? { reps_min: updates.repsMin }
          : {}),
      ...(specProj
        ? { reps_max: specProj.reps_max }
        : updates.repsMax !== undefined
          ? { reps_max: updates.repsMax }
          : {}),
      ...(updates.repsTarget !== undefined && { reps_target: updates.repsTarget }),
      ...(updates.rpeTarget !== undefined && { rpe_target: updates.rpeTarget }),
      ...(updates.percentage1rm !== undefined && { percentage_1rm: updates.percentage1rm }),
      ...(updates.tempo !== undefined && { tempo: updates.tempo }),
      ...(updates.restSeconds !== undefined && { rest_seconds: updates.restSeconds }),
      ...(updates.supersetGroup !== undefined && { superset_group: updates.supersetGroup }),
      ...(updates.isWarmup !== undefined && { is_warmup: updates.isWarmup }),
      ...(updates.notes !== undefined && { notes: updates.notes }),
      ...(specProj ? { set_specs: specProj.set_specs } : {}),
      ...(updates.setSpecs === null && { set_specs: null }),
      ...(updates.videoUrl !== undefined && { video_url: updates.videoUrl }),
    })
    .eq("id", exerciseId);
  if (error) throw new Error(`Failed to update exercise: ${error.message}`);
}

export async function removeSavedExercise(exerciseId: string, coachId: string): Promise<void> {
  // Verify ownership via session
  const { data: exercise } = await supabaseAdmin
    .from("coach_saved_exercises")
    .select("saved_session_id")
    .eq("id", exerciseId)
    .single();
  if (!exercise) throw new Error("Exercise not found");

  const { data: session } = await supabaseAdmin
    .from("coach_saved_sessions")
    .select("id")
    .eq("id", exercise.saved_session_id)
    .eq("coach_id", coachId)
    .single();
  if (!session) throw new Error("Access denied");

  const { error } = await supabaseAdmin
    .from("coach_saved_exercises")
    .delete()
    .eq("id", exerciseId);
  if (error) throw new Error(`Failed to delete exercise: ${error.message}`);
}
