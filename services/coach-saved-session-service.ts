import { supabaseAdmin } from "./supabase-admin";
import { resolveExercises } from "./exercise-catalog-service";
import { projectExerciseCompact } from "@/utils/exercise-set-specs";
import type { SetSpec } from "@/utils/exercise-set-specs";
import {
  mapSavedExerciseRow,
  mapSavedSessionRow,
} from "@/lib/coach-mappers";
import {
  copySavedExerciseRows,
  insertSavedExercises,
  recomputePlanCycleInfo,
} from "./coach-library-helpers";
import type { SavedSession } from "@/types/training";
import type {
  CoachSavedSessionRow,
  CoachSavedExerciseRow,
} from "@/lib/database-helpers";

// --- Standalone session ---

export async function createStandaloneSession(
  coachId: string,
  data: {
    name: string;
    focus?: string;
    exercises: Array<{
      name: string;
      sets: number;
      repsTarget?: string;
      rpeTarget?: number;
      restSeconds?: number;
      notes?: string;
    }>;
  }
): Promise<string> {
  const exerciseNames = data.exercises.map((e) => e.name);
  const exerciseIdMap = await resolveExercises(exerciseNames, coachId);

  const { data: session, error } = await supabaseAdmin
    .from("coach_saved_sessions")
    .insert({
      coach_id: coachId,
      saved_plan_id: null,
      name: data.name,
      focus: data.focus ?? null,
      order_index: 0,
      is_rest: false,
      session_type: "training",
    })
    .select("id")
    .single();
  if (error || !session) throw new Error(`Failed to create standalone session: ${error?.message}`);

  await insertSavedExercises(session.id, data.exercises, exerciseIdMap);
  return session.id;
}

export async function getStandaloneSessions(coachId: string): Promise<SavedSession[]> {
  const { data, error } = await supabaseAdmin
    .from("coach_saved_sessions")
    .select("*, coach_saved_exercises(*)")
    .eq("coach_id", coachId)
    .is("saved_plan_id", null)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch standalone sessions: ${error.message}`);

  return (data ?? []).map((s: CoachSavedSessionRow & { coach_saved_exercises?: CoachSavedExerciseRow[] }) => {
    const exercises = (s.coach_saved_exercises ?? [])
      .sort((a: CoachSavedExerciseRow, b: CoachSavedExerciseRow) => a.order_index - b.order_index)
      .map(mapSavedExerciseRow);
    return mapSavedSessionRow(s, exercises);
  });
}

/**
 * Duplicate a STANDALONE session (saved_plan_id IS NULL) as a verbatim
 * server-side copy — exercises carry set_specs, video_url, and resolved
 * exercise_ids as-is (never a client-composed POST, whose narrow create
 * schema would silently strip per-set data). Name deduped with " (copy N)"
 * against the coach's standalone sessions; base capped so the result stays
 * inside the 100-char name caps.
 */
export async function duplicateStandaloneSession(
  sessionId: string,
  coachId: string
): Promise<string> {
  const { data: source, error } = await supabaseAdmin
    .from("coach_saved_sessions")
    .select("*, coach_saved_exercises(*)")
    .eq("id", sessionId)
    .eq("coach_id", coachId)
    .is("saved_plan_id", null)
    .single();
  if (error || !source) throw new Error("Session not found");

  const { data: nameRows, error: namesError } = await supabaseAdmin
    .from("coach_saved_sessions")
    .select("name")
    .eq("coach_id", coachId)
    .is("saved_plan_id", null);
  if (namesError) {
    throw new Error(`Failed to check session names: ${namesError.message}`);
  }
  const taken = new Set(
    (nameRows ?? []).map((r) => r.name.trim().toLowerCase())
  );
  const base = source.name.length > 88 ? source.name.slice(0, 88) : source.name;
  let name = `${base} (copy)`;
  for (let n = 2; taken.has(name.trim().toLowerCase()); n++) {
    name = `${base} (copy ${n})`;
  }

  const { data: newSession, error: insertError } = await supabaseAdmin
    .from("coach_saved_sessions")
    .insert({
      coach_id: coachId,
      saved_plan_id: null,
      name,
      focus: source.focus,
      order_index: 0,
      // Normalize placement indices — standalone sessions aren't slotted, and
      // a stale week_index would leak into plans on insert (TECHNICAL-DEBT:
      // placeSessionOnCalendar copies week_index verbatim).
      week_index: 0,
      is_rest: false,
      estimated_duration_minutes: source.estimated_duration_minutes,
      calorie_surplus_percentage: source.calorie_surplus_percentage,
      notes: source.notes,
      session_type: source.session_type,
    })
    .select("id")
    .single();
  if (insertError || !newSession) {
    throw new Error(
      `Failed to duplicate session: ${insertError?.message ?? "no row"}`
    );
  }

  const exercises = (source.coach_saved_exercises ?? []) as CoachSavedExerciseRow[];
  if (exercises.length > 0) {
    const { error: exError } = await supabaseAdmin
      .from("coach_saved_exercises")
      .insert(copySavedExerciseRows(exercises, newSession.id));
    if (exError) {
      // Remove the half-copied session so the library never shows a shell.
      await supabaseAdmin
        .from("coach_saved_sessions")
        .delete()
        .eq("id", newSession.id)
        .eq("coach_id", coachId);
      throw new Error(`Failed to copy exercises: ${exError.message}`);
    }
  }

  return newSession.id;
}

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
