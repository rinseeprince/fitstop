import { supabaseAdmin } from "./supabase-admin";
import { resolveExercises } from "./exercise-catalog-service";
import {
  mapSavedExerciseRow,
  mapSavedSessionRow,
  mapSavedPlanRow,
} from "@/lib/coach-mappers";
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

/**
 * Fallback cycle detection when AI doesn't provide cycleLength/restDayPositions.
 * Uses a simple heuristic: one rest day after all training sessions.
 */
function detectCycleInfoFallback(
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

  // Simple fallback: sessions + 1 rest day at the end
  const trainingDays = sessions.length;
  if (trainingDays >= 7) return { cycleLength: trainingDays, restPattern: [] };

  return { cycleLength: trainingDays + 1, restPattern: [trainingDays] };
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
  coachPrompt: string,
  coachSuppliedName?: string
): Promise<string> {
  // Use AI-provided cycle info if available, otherwise fall back to heuristic
  let cycleLength: number;
  let restPattern: number[];

  if (aiPlan.cycleLength && aiPlan.restDayPositions) {
    // Sanity check: training sessions must equal cycleLength minus rest positions
    const expectedTraining = aiPlan.cycleLength - aiPlan.restDayPositions.length;
    if (expectedTraining === aiPlan.sessions.length && aiPlan.cycleLength > 0) {
      cycleLength = aiPlan.cycleLength;
      restPattern = aiPlan.restDayPositions;
    } else {
      // AI provided inconsistent data — fall back
      ({ cycleLength, restPattern } = detectCycleInfoFallback(
        aiPlan.sessions,
        aiPlan.frequencyPerWeek
      ));
    }
  } else {
    ({ cycleLength, restPattern } = detectCycleInfoFallback(
      aiPlan.sessions,
      aiPlan.frequencyPerWeek
    ));
  }

  // Batch-resolve all exercise names
  const allNames = collectExerciseNames(aiPlan.sessions);
  const exerciseIdMap = await resolveExercises(allNames, coachId);

  // Insert plan
  const resolvedName = coachSuppliedName?.trim() || aiPlan.name;
  const planRow: CoachSavedPlanInsert = {
    coach_id: coachId,
    name: resolvedName,
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

  // Build session order: interleave training sessions with rest day sessions
  // at the positions indicated by restPattern
  const restPositions = new Set(restPattern);
  let trainingIdx = 0;

  for (let pos = 0; pos < cycleLength; pos++) {
    if (restPositions.has(pos)) {
      // Insert rest day session
      const { error: restError } = await supabaseAdmin
        .from("coach_saved_sessions")
        .insert({
          coach_id: coachId,
          saved_plan_id: plan.id,
          name: "Rest",
          focus: null,
          order_index: pos,
          is_rest: true,
          estimated_duration_minutes: null,
          notes: null,
          session_type: "training",
        });
      if (restError) throw new Error(`Failed to create rest session: ${restError.message}`);
    } else {
      // Insert training session
      const s = aiPlan.sessions[trainingIdx];
      if (!s) continue;

      const sessionRow: CoachSavedSessionInsert = {
        coach_id: coachId,
        saved_plan_id: plan.id,
        name: s.name,
        focus: s.focus ?? null,
        order_index: pos,
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
      trainingIdx++;
    }
  }

  return plan.id;
}

export async function createSavedPlanManual(
  coachId: string,
  name: string,
  splitType: string,
  sessions: ManualSessionDraft[]
): Promise<string> {
  // Only collect names from training sessions — rest days have no exercises.
  const allNames: string[] = [];
  for (const s of sessions) {
    if (s.isRest) continue;
    for (const e of s.exercises) allNames.push(e.name);
  }
  const exerciseIdMap = await resolveExercises(allNames, coachId);

  // Derive cycle info from session order: rest_pattern is the indices of rest sessions.
  const cycleLength = sessions.length;
  const restPattern = sessions
    .map((s, i) => (s.isRest ? i : -1))
    .filter((i) => i >= 0);
  const trainingCount = sessions.filter((s) => !s.isRest).length;

  const planRow: CoachSavedPlanInsert = {
    coach_id: coachId,
    name,
    split_type: splitType,
    frequency_per_week: trainingCount,
    status: "draft",
    cycle_length: cycleLength,
    rest_pattern: restPattern,
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
    const isRest = !!s.isRest;
    const sessionRow: CoachSavedSessionInsert = {
      coach_id: coachId,
      saved_plan_id: plan.id,
      name: isRest ? "Rest" : s.name,
      focus: isRest ? null : (s.focus ?? null),
      order_index: i,
      is_rest: isRest,
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

    if (!isRest) {
      await insertSavedExercises(session.id, s.exercises, exerciseIdMap);
    }
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

/**
 * Clone a saved plan into a new draft under the same coach. Copies plan
 * metadata, sessions (with is_rest flags), and exercises. The source plan is
 * untouched — the coach uses this to customize a library plan for one client
 * without mutating the template. The returned draft is what the coach edits
 * and ultimately applies; the library plan stays as the reusable reference.
 */
export async function cloneSavedPlanAsDraft(
  sourcePlanId: string,
  coachId: string,
): Promise<string> {
  // Fetch source plan with all nested data, verifying ownership.
  const source = await getSavedPlanById(sourcePlanId, coachId);
  if (!source) throw new Error("Plan not found or access denied");

  // Insert the cloned plan row. Status becomes 'draft' so DraftEditor shows
  // the Save-to-Library / Discard flow rather than Apply-only.
  const planRow: CoachSavedPlanInsert = {
    coach_id: coachId,
    name: `${source.name} (customized)`,
    description: source.description ?? null,
    split_type: source.splitType ?? null,
    frequency_per_week: source.frequencyPerWeek ?? null,
    status: "draft",
    cycle_length: source.cycleLength ?? null,
    rest_pattern: source.restPattern ?? [],
    source: "manual",
    coach_prompt: null,
    program_duration_weeks: source.programDurationWeeks ?? null,
    default_surplus_percentage: source.defaultSurplusPercentage ?? null,
  };

  const { data: newPlan, error: planError } = await supabaseAdmin
    .from("coach_saved_plans")
    .insert(planRow)
    .select("id")
    .single();
  if (planError || !newPlan) {
    throw new Error(`Failed to clone plan: ${planError?.message}`);
  }

  // Copy sessions + their exercises one at a time so we can map each new
  // session id back to its exercises correctly.
  for (const session of source.sessions) {
    const sessionRow: CoachSavedSessionInsert = {
      coach_id: coachId,
      saved_plan_id: newPlan.id,
      name: session.name,
      focus: session.focus ?? null,
      order_index: session.orderIndex,
      is_rest: session.isRest,
      estimated_duration_minutes: session.estimatedDurationMinutes ?? null,
      calorie_surplus_percentage: session.calorieSurplusPercentage ?? null,
      notes: session.notes ?? null,
      session_type: session.sessionType ?? "training",
    };

    const { data: newSession, error: sessionError } = await supabaseAdmin
      .from("coach_saved_sessions")
      .insert(sessionRow)
      .select("id")
      .single();
    if (sessionError || !newSession) {
      throw new Error(`Failed to clone session: ${sessionError?.message}`);
    }

    if (session.isRest || session.exercises.length === 0) continue;

    // coach_saved_exercises has no coach_id column — ownership is inferred
    // via saved_session_id → coach_saved_sessions → coach_id.
    const exerciseRows = session.exercises.map((e) => ({
      saved_session_id: newSession.id,
      exercise_id: e.exerciseId ?? null,
      name: e.name,
      order_index: e.orderIndex,
      sets: e.sets,
      reps_min: e.repsMin ?? null,
      reps_max: e.repsMax ?? null,
      reps_target: e.repsTarget ?? null,
      rpe_target: e.rpeTarget ?? null,
      percentage_1rm: e.percentage1rm ?? null,
      tempo: e.tempo ?? null,
      rest_seconds: e.restSeconds ?? null,
      superset_group: e.supersetGroup ?? null,
      is_warmup: e.isWarmup ?? false,
      notes: e.notes ?? null,
    }));

    const { error: exerciseError } = await supabaseAdmin
      .from("coach_saved_exercises")
      .insert(exerciseRows);
    if (exerciseError) {
      throw new Error(`Failed to clone exercises: ${exerciseError.message}`);
    }
  }

  return newPlan.id;
}

/**
 * Input shape for overwriteSavedPlan — a working-copy of the plan's editable
 * state. Sessions must already have `orderIndex` reflecting their desired new
 * order. Rest sessions should have `isRest: true` and no exercises.
 */
export type OverwriteSavedPlanInput = {
  name?: string;
  description?: string | null;
  defaultSurplusPercentage?: number | null;
  sessions: Array<{
    name: string;
    focus?: string | null;
    orderIndex: number;
    isRest: boolean;
    estimatedDurationMinutes?: number | null;
    calorieSurplusPercentage?: number | null;
    notes?: string | null;
    sessionType?: string | null;
    exercises: Array<{
      name: string;
      exerciseId?: string | null;
      orderIndex: number;
      sets: number;
      repsMin?: number | null;
      repsMax?: number | null;
      repsTarget?: string | null;
      rpeTarget?: number | null;
      percentage1rm?: number | null;
      tempo?: string | null;
      restSeconds?: number | null;
      notes?: string | null;
      supersetGroup?: string | null;
      isWarmup?: boolean;
    }>;
  }>;
};

/**
 * Replace a saved plan's sessions + exercises with a new working-copy structure.
 * Used by "Save and Update Plan" — the coach has been editing an in-memory
 * working copy and is now committing those changes to the library template.
 *
 * Strategy: delete all existing sessions under the plan (cascade-deletes
 * exercises), then insert the new structure. Plan metadata (name, etc.) is
 * patched via updateSavedPlan separately; only sessions/exercises + derived
 * cycle info are handled here.
 *
 * Does NOT touch any client-side training_plans / training_events — those
 * reference training_sessions in the applied-calendar tables, which are
 * independent of coach_saved_sessions.
 */
export async function overwriteSavedPlan(
  planId: string,
  coachId: string,
  input: OverwriteSavedPlanInput,
): Promise<void> {
  // Ownership check.
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from("coach_saved_plans")
    .select("id")
    .eq("id", planId)
    .eq("coach_id", coachId)
    .single();
  if (fetchError || !existing) throw new Error("Plan not found or access denied");

  // Patch plan-level metadata (if provided) and derived cycle info.
  const cycleLength = input.sessions.length;
  const restPattern = input.sessions
    .map((s, i) => (s.isRest ? i : -1))
    .filter((i) => i >= 0);
  const frequencyPerWeek = cycleLength - restPattern.length;

  const { error: planUpdateError } = await supabaseAdmin
    .from("coach_saved_plans")
    .update({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.defaultSurplusPercentage !== undefined && {
        default_surplus_percentage: input.defaultSurplusPercentage,
      }),
      cycle_length: cycleLength,
      rest_pattern: restPattern,
      frequency_per_week: frequencyPerWeek,
    })
    .eq("id", planId)
    .eq("coach_id", coachId);
  if (planUpdateError) {
    throw new Error(`Failed to update plan metadata: ${planUpdateError.message}`);
  }

  // Collect all exercise names for catalog resolution before wiping the old
  // rows — we want to preserve exercise_id where the catalog already has them.
  const allNames: string[] = [];
  for (const s of input.sessions) {
    if (s.isRest) continue;
    for (const e of s.exercises) {
      // Only resolve names that don't already carry an exerciseId.
      if (!e.exerciseId) allNames.push(e.name);
    }
  }
  const exerciseIdMap = await resolveExercises(allNames, coachId);

  // Wipe existing sessions (cascade-deletes their exercises).
  const { error: deleteError } = await supabaseAdmin
    .from("coach_saved_sessions")
    .delete()
    .eq("saved_plan_id", planId);
  if (deleteError) {
    throw new Error(`Failed to clear existing sessions: ${deleteError.message}`);
  }

  // Insert the new structure in order.
  for (const s of input.sessions) {
    const sessionRow: CoachSavedSessionInsert = {
      coach_id: coachId,
      saved_plan_id: planId,
      name: s.isRest ? "Rest" : s.name,
      focus: s.isRest ? null : (s.focus ?? null),
      order_index: s.orderIndex,
      is_rest: s.isRest,
      estimated_duration_minutes: s.estimatedDurationMinutes ?? null,
      calorie_surplus_percentage: s.calorieSurplusPercentage ?? null,
      notes: s.notes ?? null,
      session_type: s.sessionType ?? "training",
    };

    const { data: newSession, error: sessionError } = await supabaseAdmin
      .from("coach_saved_sessions")
      .insert(sessionRow)
      .select("id")
      .single();
    if (sessionError || !newSession) {
      throw new Error(`Failed to insert session "${s.name}": ${sessionError?.message}`);
    }

    if (s.isRest || s.exercises.length === 0) continue;

    // coach_saved_exercises has no coach_id column — ownership is inferred
    // via saved_session_id → coach_saved_sessions → coach_id.
    const exerciseRows = s.exercises.map((e) => ({
      saved_session_id: newSession.id,
      exercise_id: e.exerciseId ?? exerciseIdMap.get(e.name) ?? null,
      name: e.name,
      order_index: e.orderIndex,
      sets: e.sets,
      reps_min: e.repsMin ?? null,
      reps_max: e.repsMax ?? null,
      reps_target: e.repsTarget ?? null,
      rpe_target: e.rpeTarget ?? null,
      percentage_1rm: e.percentage1rm ?? null,
      tempo: e.tempo ?? null,
      rest_seconds: e.restSeconds ?? null,
      superset_group: e.supersetGroup ?? null,
      is_warmup: e.isWarmup ?? false,
      notes: e.notes ?? null,
    }));

    const { error: exError } = await supabaseAdmin
      .from("coach_saved_exercises")
      .insert(exerciseRows);
    if (exError) {
      throw new Error(`Failed to insert exercises for "${s.name}": ${exError.message}`);
    }
  }
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

/**
 * Recomputes cycle_length + rest_pattern + frequency_per_week for a plan from
 * its current session list. Call after any session insert/delete/reorder/rest-toggle
 * so the plan's cycle metadata stays consistent with its sessions — the calendar
 * generator and the AI/manual initial-insert logic both assume this invariant.
 */
async function recomputePlanCycleInfo(planId: string, coachId: string): Promise<void> {
  const { data: sessions, error } = await supabaseAdmin
    .from("coach_saved_sessions")
    .select("is_rest, order_index")
    .eq("saved_plan_id", planId)
    .order("order_index", { ascending: true });
  if (error) throw new Error(`Failed to read sessions for cycle recompute: ${error.message}`);

  const cycleLength = sessions?.length ?? 0;
  const restPattern = (sessions ?? [])
    .map((s, i) => (s.is_rest ? i : -1))
    .filter((i) => i >= 0);
  const trainingCount = cycleLength - restPattern.length;

  const { error: updateError } = await supabaseAdmin
    .from("coach_saved_plans")
    .update({
      cycle_length: cycleLength,
      rest_pattern: restPattern,
      frequency_per_week: trainingCount,
    })
    .eq("id", planId)
    .eq("coach_id", coachId);
  if (updateError) throw new Error(`Failed to update plan cycle info: ${updateError.message}`);
}

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

