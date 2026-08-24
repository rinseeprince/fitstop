import { supabaseAdmin } from "./supabase-admin";
import type { CoachSavedExerciseInsert } from "@/lib/database-helpers";

// --- Save from calendar ---
// Reads from client tables (training_sessions, training_exercises) and writes to
// library tables (coach_saved_*). The plan-level twin, savePlanFromCalendar, was
// removed with the calendar's "Save as plan" week action: it never saved the
// clicked week — it copied the whole program's active sessions and used the week
// only for the default name.

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
  // The !inner joins are load-bearing: a left join would return the row with a
  // null parent and the coach_id filter would not exclude it.
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
        prescribed_fields: e.prescribed_fields ?? null,
      })
    );
    await supabaseAdmin.from("coach_saved_exercises").insert(exerciseRows);
  }

  return savedSession.id;
}
