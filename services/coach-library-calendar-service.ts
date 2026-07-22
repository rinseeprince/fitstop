import { supabaseAdmin } from "./supabase-admin";
import type { CoachSavedExerciseInsert } from "@/lib/database-helpers";

// --- Save from calendar ---
// These functions read from client tables (training_plans, training_sessions,
// training_exercises) and write to library tables (coach_saved_*).

export async function savePlanFromCalendar(
  coachId: string,
  clientId: string,
  planId: string,
  weekStartDate: string,
  name: string
): Promise<string> {
  // Fetch plan + sessions + exercises from client's training plan
  const { data: plan } = await supabaseAdmin
    .from("training_plans")
    .select("*, training_sessions(*, training_exercises(*))")
    .eq("id", planId)
    .eq("client_id", clientId)
    .single();
  if (!plan) throw new Error("Training plan not found");

  const activeSessions = (plan.training_sessions ?? []).filter(
    (s: { is_active: boolean }) => s.is_active
  );

  // Create saved plan
  const { data: savedPlan, error: spError } = await supabaseAdmin
    .from("coach_saved_plans")
    .insert({
      coach_id: coachId,
      name,
      split_type: plan.split_type,
      frequency_per_week: plan.frequency_per_week,
      status: "saved",
      program_duration_weeks: Math.max(1, Math.ceil(activeSessions.length / 7)),
      source: "calendar",
    })
    .select("id")
    .single();
  if (spError || !savedPlan) throw new Error(`Failed to save plan from calendar: ${spError?.message}`);

  // Copy sessions and exercises
  for (let i = 0; i < activeSessions.length; i++) {
    const s = activeSessions[i];
    const { data: savedSession, error: ssError } = await supabaseAdmin
      .from("coach_saved_sessions")
      .insert({
        coach_id: coachId,
        saved_plan_id: savedPlan.id,
        name: s.name,
        focus: s.focus,
        order_index: i,
        is_rest: false,
        estimated_duration_minutes: s.estimated_duration_minutes,
        calorie_surplus_percentage: s.calorie_surplus_percentage ?? null,
        notes: s.notes,
        session_type: "training",
      })
      .select("id")
      .single();
    if (ssError || !savedSession) continue;

    const activeExercises = (s.training_exercises ?? []).filter(
      (e: { is_active: boolean }) => e.is_active
    );
    if (activeExercises.length > 0) {
       
      const exerciseRows: CoachSavedExerciseInsert[] = activeExercises.map(
        (e: any, idx: number) => ({
          saved_session_id: savedSession.id,
          exercise_id: e.exercise_id ?? null,
          name: e.name,
          order_index: idx,
          sets: e.sets,
          reps_min: e.reps_min ?? null,
          reps_max: e.reps_max ?? null,
          reps_target: e.reps_target ?? null,
          rpe_target: e.rpe_target ?? null,
          percentage_1rm: e.percentage_1rm ?? null,
          tempo: e.tempo ?? null,
          rest_seconds: e.rest_seconds ?? null,
          superset_group: e.superset_group ?? null,
          is_warmup: e.is_warmup ?? false,
          notes: e.notes ?? null,
          set_specs: e.set_specs ?? null,
          video_url: e.video_url ?? null,
        })
      );
      await supabaseAdmin.from("coach_saved_exercises").insert(exerciseRows);
    }
  }

  return savedPlan.id;
}

export async function saveSessionFromCalendar(
  coachId: string,
  sourceSessionId: string,
  name: string
): Promise<string> {
  // Fetch session + exercises, SCOPED to a client owned by this coach.
  // training_sessions -> training_plans -> clients.coach_id verifies the source
  // belongs to one of the coach's own clients. Without this, a coach could copy
  // another coach's client's session (full exercise prescription) into their
  // library via a known/guessed sourceSessionId — cross-tenant exfiltration.
  // Mirrors the ownership scoping in savePlanFromCalendar above.
  const { data: source } = await supabaseAdmin
    .from("training_sessions")
    .select("*, training_exercises(*), training_plans!inner(clients!inner(coach_id))")
    .eq("id", sourceSessionId)
    .eq("training_plans.clients.coach_id", coachId)
    .maybeSingle();
  if (!source) throw new Error("Session not found");

  // Create standalone saved session
  const { data: savedSession, error } = await supabaseAdmin
    .from("coach_saved_sessions")
    .insert({
      coach_id: coachId,
      saved_plan_id: null,
      name,
      focus: source.focus,
      order_index: 0,
      is_rest: false,
      estimated_duration_minutes: source.estimated_duration_minutes,
      calorie_surplus_percentage: source.calorie_surplus_percentage ?? null,
      notes: source.notes,
      session_type: "training",
    })
    .select("id")
    .single();
  if (error || !savedSession) throw new Error(`Failed to save session from calendar: ${error?.message}`);

  const activeExercises = (source.training_exercises ?? []).filter(
    (e: { is_active: boolean }) => e.is_active
  );
  if (activeExercises.length > 0) {
     
    const exerciseRows: CoachSavedExerciseInsert[] = activeExercises.map(
      (e: any, idx: number) => ({
        saved_session_id: savedSession.id,
        exercise_id: e.exercise_id ?? null,
        name: e.name,
        order_index: idx,
        sets: e.sets,
        reps_min: e.reps_min ?? null,
        reps_max: e.reps_max ?? null,
        reps_target: e.reps_target ?? null,
        rpe_target: e.rpe_target ?? null,
        percentage_1rm: e.percentage_1rm ?? null,
        tempo: e.tempo ?? null,
        rest_seconds: e.rest_seconds ?? null,
        superset_group: e.superset_group ?? null,
        is_warmup: e.is_warmup ?? false,
        notes: e.notes ?? null,
        set_specs: e.set_specs ?? null,
        video_url: e.video_url ?? null,
      })
    );
    await supabaseAdmin.from("coach_saved_exercises").insert(exerciseRows);
  }

  return savedSession.id;
}
