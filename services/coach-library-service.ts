import { supabaseAdmin } from "./supabase-admin";
import { resolveExercises } from "./exercise-catalog-service";
import type {
  SavedPlan,
  SavedSession,
  SavedExercise,
  AIGeneratedPlan,
  ManualSessionDraft,
} from "@/types/training";
import type {
  CoachSavedPlanRow,
  CoachSavedSessionRow,
  CoachSavedExerciseRow,
  CoachSavedPlanInsert,
  CoachSavedSessionInsert,
  CoachSavedExerciseInsert,
} from "@/lib/database-helpers";

// --- Row mappers ---

function mapSavedExerciseRow(row: CoachSavedExerciseRow): SavedExercise {
  return {
    id: row.id,
    savedSessionId: row.saved_session_id,
    exerciseId: row.exercise_id ?? null,
    name: row.name,
    orderIndex: row.order_index,
    sets: row.sets,
    repsMin: row.reps_min ?? null,
    repsMax: row.reps_max ?? null,
    repsTarget: row.reps_target ?? null,
    rpeTarget: row.rpe_target ?? null,
    percentage1rm: row.percentage_1rm ?? null,
    tempo: row.tempo ?? null,
    restSeconds: row.rest_seconds ?? null,
    supersetGroup: row.superset_group ?? null,
    isWarmup: row.is_warmup ?? false,
    notes: row.notes ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSavedSessionRow(
  row: CoachSavedSessionRow,
  exercises: SavedExercise[] = []
): SavedSession {
  return {
    id: row.id,
    coachId: row.coach_id,
    savedPlanId: row.saved_plan_id ?? null,
    name: row.name,
    focus: row.focus ?? null,
    orderIndex: row.order_index,
    isRest: row.is_rest ?? false,
    estimatedDurationMinutes: row.estimated_duration_minutes ?? null,
    calorieSurplusPercentage: row.calorie_surplus_percentage ?? null,
    notes: row.notes ?? null,
    sessionType: row.session_type ?? "training",
    exercises,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSavedPlanRow(
  row: CoachSavedPlanRow,
  sessions: SavedSession[] = []
): SavedPlan {
  return {
    id: row.id,
    coachId: row.coach_id,
    name: row.name,
    description: row.description ?? null,
    splitType: row.split_type ?? null,
    frequencyPerWeek: row.frequency_per_week ?? null,
    status: row.status as "draft" | "saved",
    cycleLength: row.cycle_length ?? null,
    restPattern: row.rest_pattern ?? [],
    defaultSurplusPercentage: row.default_surplus_percentage
      ? Number(row.default_surplus_percentage)
      : null,
    source: row.source ?? "manual",
    coachPrompt: row.coach_prompt ?? null,
    programDurationWeeks: row.program_duration_weeks ?? null,
    sessions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- Helper: collect all exercise names from AI sessions ---

function collectExerciseNames(
  sessions: AIGeneratedPlan["sessions"]
): string[] {
  const names: string[] = [];
  for (const s of sessions) {
    for (const e of s.exercises) {
      names.push(e.name);
    }
  }
  return names;
}

// --- Helper: detect cycle length and rest pattern ---

function detectCycleInfo(
  sessions: AIGeneratedPlan["sessions"],
  frequencyPerWeek: number | undefined
): { cycleLength: number; restPattern: number[] } {
  const hasDayOfWeek = sessions.some((s) => s.dayOfWeek);
  if (hasDayOfWeek) {
    const dayMap: Record<string, number> = {
      monday: 0, tuesday: 1, wednesday: 2, thursday: 3,
      friday: 4, saturday: 5, sunday: 6,
    };
    const assigned = new Set(
      sessions
        .filter((s) => s.dayOfWeek)
        .map((s) => dayMap[s.dayOfWeek!.toLowerCase()] ?? -1)
        .filter((d) => d >= 0)
    );
    const restDays: number[] = [];
    for (let i = 0; i < 7; i++) {
      if (!assigned.has(i)) restDays.push(i);
    }
    return { cycleLength: 7, restPattern: restDays };
  }

  // No day assignments: infer from session count
  const trainingDays = sessions.length;
  const freq = frequencyPerWeek ?? trainingDays;
  if (freq >= 7) return { cycleLength: trainingDays, restPattern: [] };

  // e.g., PPL = 3 training + inferred rest = cycle of 4
  const restDaysPerCycle = Math.max(0, Math.round((7 - freq) / freq * trainingDays));
  const cycleLength = trainingDays + restDaysPerCycle;
  const restPattern = Array.from(
    { length: restDaysPerCycle },
    (_, i) => trainingDays + i
  );
  return { cycleLength, restPattern };
}

// --- Insert exercises for a saved session ---

async function insertSavedExercises(
  sessionId: string,
  exercises: Array<{
    name: string;
    sets: number;
    repsMin?: number;
    repsMax?: number;
    repsTarget?: string;
    rpeTarget?: number;
    percentage1rm?: number;
    tempo?: string;
    restSeconds?: number;
    notes?: string;
    supersetGroup?: string;
    isWarmup?: boolean;
  }>,
  exerciseIdMap: Map<string, string>
): Promise<void> {
  if (exercises.length === 0) return;
  const rows: CoachSavedExerciseInsert[] = exercises.map((e, i) => ({
    saved_session_id: sessionId,
    exercise_id: exerciseIdMap.get(e.name.trim().toLowerCase()) ?? null,
    name: e.name,
    order_index: i,
    sets: e.sets,
    reps_min: e.repsMin ?? null,
    reps_max: e.repsMax ?? null,
    reps_target: e.repsTarget ?? null,
    rpe_target: e.rpeTarget ?? null,
    percentage_1rm: e.percentage1rm ?? null,
    tempo: e.tempo ?? null,
    rest_seconds: e.restSeconds ?? null,
    notes: e.notes ?? null,
    superset_group: e.supersetGroup ?? null,
    is_warmup: e.isWarmup ?? false,
  }));

  const { error } = await supabaseAdmin
    .from("coach_saved_exercises")
    .insert(rows);
  if (error) throw new Error(`Failed to insert saved exercises: ${error.message}`);
}

// --- Plan creation ---

export async function createSavedPlanFromAI(
  coachId: string,
  aiPlan: AIGeneratedPlan,
  coachPrompt: string
): Promise<string> {
  const { cycleLength, restPattern } = detectCycleInfo(
    aiPlan.sessions,
    aiPlan.frequencyPerWeek
  );

  // Batch-resolve all exercise names
  const allNames = collectExerciseNames(aiPlan.sessions);
  const exerciseIdMap = await resolveExercises(allNames, coachId);

  // Insert plan
  const planRow: CoachSavedPlanInsert = {
    coach_id: coachId,
    name: aiPlan.name,
    description: aiPlan.description ?? null,
    split_type: aiPlan.splitType ?? null,
    frequency_per_week: aiPlan.frequencyPerWeek ?? null,
    status: "draft",
    cycle_length: cycleLength,
    rest_pattern: restPattern,
    source: "ai",
    coach_prompt: coachPrompt,
    program_duration_weeks: aiPlan.programDurationWeeks ?? null,
  };

  const { data: plan, error: planError } = await supabaseAdmin
    .from("coach_saved_plans")
    .insert(planRow)
    .select("id")
    .single();
  if (planError || !plan) throw new Error(`Failed to create saved plan: ${planError?.message}`);

  // Insert sessions + exercises
  for (let i = 0; i < aiPlan.sessions.length; i++) {
    const s = aiPlan.sessions[i];
    const sessionRow: CoachSavedSessionInsert = {
      coach_id: coachId,
      saved_plan_id: plan.id,
      name: s.name,
      focus: s.focus ?? null,
      order_index: i,
      is_rest: false,
      estimated_duration_minutes: s.estimatedDurationMinutes ?? null,
      notes: s.notes ?? null,
      session_type: "training",
    };

    const { data: session, error: sessionError } = await supabaseAdmin
      .from("coach_saved_sessions")
      .insert(sessionRow)
      .select("id")
      .single();
    if (sessionError || !session) throw new Error(`Failed to create saved session: ${sessionError?.message}`);

    await insertSavedExercises(session.id, s.exercises, exerciseIdMap);
  }

  return plan.id;
}

export async function createSavedPlanManual(
  coachId: string,
  name: string,
  splitType: string,
  sessions: ManualSessionDraft[]
): Promise<string> {
  // Collect and resolve exercise names
  const allNames: string[] = [];
  for (const s of sessions) {
    for (const e of s.exercises) allNames.push(e.name);
  }
  const exerciseIdMap = await resolveExercises(allNames, coachId);

  const planRow: CoachSavedPlanInsert = {
    coach_id: coachId,
    name,
    split_type: splitType,
    frequency_per_week: sessions.length,
    status: "draft",
    cycle_length: sessions.length,
    rest_pattern: [],
    source: "manual",
  };

  const { data: plan, error: planError } = await supabaseAdmin
    .from("coach_saved_plans")
    .insert(planRow)
    .select("id")
    .single();
  if (planError || !plan) throw new Error(`Failed to create saved plan: ${planError?.message}`);

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const sessionRow: CoachSavedSessionInsert = {
      coach_id: coachId,
      saved_plan_id: plan.id,
      name: s.name,
      focus: s.focus ?? null,
      order_index: i,
      is_rest: false,
      estimated_duration_minutes: null,
      notes: null,
      session_type: "training",
    };

    const { data: session, error: sessionError } = await supabaseAdmin
      .from("coach_saved_sessions")
      .insert(sessionRow)
      .select("id")
      .single();
    if (sessionError || !session) throw new Error(`Failed to create saved session: ${sessionError?.message}`);

    await insertSavedExercises(session.id, s.exercises, exerciseIdMap);
  }

  return plan.id;
}

// --- Promote draft to saved ---

export async function promoteDraftToSaved(
  planId: string,
  coachId: string,
  options: { saveSessionsIndividually: boolean }
): Promise<{ nameConflict?: string }> {
  // Fetch the plan
  const { data: plan, error } = await supabaseAdmin
    .from("coach_saved_plans")
    .select("id, name, coach_id, status")
    .eq("id", planId)
    .single();
  if (error || !plan) throw new Error("Plan not found");
  if (plan.coach_id !== coachId) throw new Error("Access denied");
  if (plan.status !== "draft") throw new Error("Plan is not a draft");

  // Check name conflict against saved plans
  const { data: existingPlan } = await supabaseAdmin
    .from("coach_saved_plans")
    .select("id")
    .eq("coach_id", coachId)
    .eq("status", "saved")
    .ilike("name", plan.name)
    .neq("id", planId)
    .maybeSingle();

  if (existingPlan) {
    return { nameConflict: "A plan with this name already exists in your library" };
  }

  // Promote
  const { error: updateError } = await supabaseAdmin
    .from("coach_saved_plans")
    .update({ status: "saved", updated_at: new Date().toISOString() })
    .eq("id", planId);
  if (updateError) throw new Error(`Failed to promote plan: ${updateError.message}`);

  // Optionally save sessions individually
  if (options.saveSessionsIndividually) {
    const { data: sessions } = await supabaseAdmin
      .from("coach_saved_sessions")
      .select("*, coach_saved_exercises(*)")
      .eq("saved_plan_id", planId)
      .eq("is_rest", false)
      .order("order_index");

    for (const s of sessions ?? []) {
      // Check for existing standalone session with same name
      const { data: existing } = await supabaseAdmin
        .from("coach_saved_sessions")
        .select("id")
        .eq("coach_id", coachId)
        .is("saved_plan_id", null)
        .ilike("name", s.name)
        .maybeSingle();

      if (existing) continue; // Dedup: skip if standalone already exists

      // Create standalone copy
      const { data: newSession, error: sError } = await supabaseAdmin
        .from("coach_saved_sessions")
        .insert({
          coach_id: coachId,
          saved_plan_id: null,
          name: s.name,
          focus: s.focus,
          order_index: 0,
          is_rest: false,
          estimated_duration_minutes: s.estimated_duration_minutes,
          calorie_surplus_percentage: s.calorie_surplus_percentage,
          notes: s.notes,
          session_type: s.session_type,
        })
        .select("id")
        .single();
      if (sError || !newSession) continue;

      // Copy exercises
      const exercises = (s.coach_saved_exercises ?? []) as CoachSavedExerciseRow[];
      if (exercises.length > 0) {
        const exerciseRows: CoachSavedExerciseInsert[] = exercises.map((e) => ({
          saved_session_id: newSession.id,
          exercise_id: e.exercise_id,
          name: e.name,
          order_index: e.order_index,
          sets: e.sets,
          reps_min: e.reps_min,
          reps_max: e.reps_max,
          reps_target: e.reps_target,
          rpe_target: e.rpe_target,
          percentage_1rm: e.percentage_1rm,
          tempo: e.tempo,
          rest_seconds: e.rest_seconds,
          superset_group: e.superset_group,
          is_warmup: e.is_warmup,
          notes: e.notes,
        }));
        await supabaseAdmin.from("coach_saved_exercises").insert(exerciseRows);
      }
    }
  }

  return {};
}

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

// --- Query functions ---

export async function getSavedPlans(coachId: string): Promise<SavedPlan[]> {
  const { data, error } = await supabaseAdmin
    .from("coach_saved_plans")
    .select("*, coach_saved_sessions(*, coach_saved_exercises(*))")
    .eq("coach_id", coachId)
    .eq("status", "saved")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch saved plans: ${error.message}`);

  return (data ?? []).map((row) => {
    const sessions = ((row.coach_saved_sessions ?? []) as CoachSavedSessionRow[])
      .sort((a, b) => a.order_index - b.order_index)
      .map((s: CoachSavedSessionRow & { coach_saved_exercises?: CoachSavedExerciseRow[] }) => {
        const exercises = (s.coach_saved_exercises ?? [])
          .sort((a: CoachSavedExerciseRow, b: CoachSavedExerciseRow) => a.order_index - b.order_index)
          .map(mapSavedExerciseRow);
        return mapSavedSessionRow(s, exercises);
      });
    return mapSavedPlanRow(row as CoachSavedPlanRow, sessions);
  });
}

export async function getSavedPlanById(
  planId: string,
  coachId: string
): Promise<SavedPlan | null> {
  const { data, error } = await supabaseAdmin
    .from("coach_saved_plans")
    .select("*, coach_saved_sessions(*, coach_saved_exercises(*))")
    .eq("id", planId)
    .eq("coach_id", coachId)
    .single();

  if (error || !data) return null;

  const sessions = ((data.coach_saved_sessions ?? []) as CoachSavedSessionRow[])
    .sort((a, b) => a.order_index - b.order_index)
    .map((s: CoachSavedSessionRow & { coach_saved_exercises?: CoachSavedExerciseRow[] }) => {
      const exercises = (s.coach_saved_exercises ?? [])
        .sort((a: CoachSavedExerciseRow, b: CoachSavedExerciseRow) => a.order_index - b.order_index)
        .map(mapSavedExerciseRow);
      return mapSavedSessionRow(s, exercises);
    });
  return mapSavedPlanRow(data as CoachSavedPlanRow, sessions);
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

// --- Update / Delete ---

export async function updateSavedPlan(
  planId: string,
  coachId: string,
  updates: {
    name?: string;
    description?: string | null;
    splitType?: string | null;
    frequencyPerWeek?: number | null;
    cycleLength?: number | null;
    restPattern?: number[];
    defaultSurplusPercentage?: number | null;
    programDurationWeeks?: number | null;
  }
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("coach_saved_plans")
    .update({
      ...(updates.name !== undefined && { name: updates.name }),
      ...(updates.description !== undefined && { description: updates.description }),
      ...(updates.splitType !== undefined && { split_type: updates.splitType }),
      ...(updates.frequencyPerWeek !== undefined && { frequency_per_week: updates.frequencyPerWeek }),
      ...(updates.cycleLength !== undefined && { cycle_length: updates.cycleLength }),
      ...(updates.restPattern !== undefined && { rest_pattern: updates.restPattern }),
      ...(updates.defaultSurplusPercentage !== undefined && { default_surplus_percentage: updates.defaultSurplusPercentage }),
      ...(updates.programDurationWeeks !== undefined && { program_duration_weeks: updates.programDurationWeeks }),
    })
    .eq("id", planId)
    .eq("coach_id", coachId);
  if (error) throw new Error(`Failed to update saved plan: ${error.message}`);
}

export async function deleteSavedPlan(planId: string, coachId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("coach_saved_plans")
    .delete()
    .eq("id", planId)
    .eq("coach_id", coachId);
  if (error) throw new Error(`Failed to delete saved plan: ${error.message}`);
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
}

export async function removeSavedSession(sessionId: string, coachId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("coach_saved_sessions")
    .delete()
    .eq("id", sessionId)
    .eq("coach_id", coachId);
  if (error) throw new Error(`Failed to delete session: ${error.message}`);
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

  const { data, error } = await supabaseAdmin
    .from("coach_saved_exercises")
    .insert({
      saved_session_id: sessionId,
      exercise_id: exerciseIdMap.get(exercise.name.trim().toLowerCase()) ?? null,
      name: exercise.name,
      order_index: nextIndex,
      sets: exercise.sets,
      reps_min: exercise.repsMin ?? null,
      reps_max: exercise.repsMax ?? null,
      reps_target: exercise.repsTarget ?? null,
      rpe_target: exercise.rpeTarget ?? null,
      percentage_1rm: exercise.percentage1rm ?? null,
      tempo: exercise.tempo ?? null,
      rest_seconds: exercise.restSeconds ?? null,
      superset_group: exercise.supersetGroup ?? null,
      is_warmup: exercise.isWarmup ?? false,
      notes: exercise.notes ?? null,
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

  const { error } = await supabaseAdmin
    .from("coach_saved_exercises")
    .update({
      ...exerciseIdUpdate,
      ...(updates.name !== undefined && { name: updates.name }),
      ...(updates.sets !== undefined && { sets: updates.sets }),
      ...(updates.repsMin !== undefined && { reps_min: updates.repsMin }),
      ...(updates.repsMax !== undefined && { reps_max: updates.repsMax }),
      ...(updates.repsTarget !== undefined && { reps_target: updates.repsTarget }),
      ...(updates.rpeTarget !== undefined && { rpe_target: updates.rpeTarget }),
      ...(updates.percentage1rm !== undefined && { percentage_1rm: updates.percentage1rm }),
      ...(updates.tempo !== undefined && { tempo: updates.tempo }),
      ...(updates.restSeconds !== undefined && { rest_seconds: updates.restSeconds }),
      ...(updates.supersetGroup !== undefined && { superset_group: updates.supersetGroup }),
      ...(updates.isWarmup !== undefined && { is_warmup: updates.isWarmup }),
      ...(updates.notes !== undefined && { notes: updates.notes }),
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

