import { supabaseAdmin } from "./supabase-admin";
import { insertSavedGroupRows, type SavedGroupRows } from "./coach-library-helpers";
import {
  EXERCISE_WITH_GROUP_COLUMNS,
  mapExerciseRowsToGroups,
  type TrainingExerciseWithGroupRow,
} from "./training-mappers";
import type { TrainingExerciseGroup } from "@/types/training";
import { groupSettingsToRow } from "@/utils/exercise-groups";
import type { Json } from "@/types/database";

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
    .select(
      `*, training_exercises!training_exercises_session_id_fkey(${EXERCISE_WITH_GROUP_COLUMNS}), training_plans!inner(clients!inner(coach_id))`,
    )
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

  // The session's live exercises in their groups, copied verbatim: every
  // group setting and every exercise column as it is, positions renumbered over
  // what is live.
  const activeRows = (
    (source.training_exercises ?? []) as unknown as TrainingExerciseWithGroupRow[]
  ).filter((e) => e.is_active);
  try {
    await insertSavedGroupRows(
      savedGroupRowsFromTrainingGroups(savedSession.id, mapExerciseRowsToGroups(activeRows)),
    );
  } catch (copyError) {
    // No shell sessions in the library: the copy that failed takes its session
    // (and any group that landed) with it.
    const { error: cleanupError } = await supabaseAdmin
      .from("coach_saved_sessions")
      .delete()
      .eq("id", savedSession.id)
      .eq("coach_id", coachId);
    const copyMsg = copyError instanceof Error ? copyError.message : String(copyError);
    throw new Error(
      cleanupError ? `${copyMsg}; cleanup also failed: ${cleanupError.message}` : copyMsg,
    );
  }

  return savedSession.id;
}

/** A client session's groups as library rows under `sessionId`, verbatim. */
function savedGroupRowsFromTrainingGroups(
  sessionId: string,
  groups: readonly TrainingExerciseGroup[],
): SavedGroupRows {
  const rows: SavedGroupRows = { groups: [], exercises: [] };
  groups.forEach((group, groupIndex) => {
    const groupId = crypto.randomUUID();
    rows.groups.push({
      id: groupId,
      saved_session_id: sessionId,
      order_index: groupIndex,
      ...groupSettingsToRow(group),
    });
    group.exercises.forEach((e, exerciseIndex) => {
      rows.exercises.push({
        saved_session_id: sessionId,
        group_id: groupId,
        exercise_id: e.exerciseId ?? null,
        name: e.name,
        order_index: exerciseIndex,
        sets: e.sets,
        reps_min: e.repsMin ?? null,
        reps_max: e.repsMax ?? null,
        reps_target: e.repsTarget ?? null,
        rpe_target: e.rpeTarget ?? null,
        percentage_1rm: e.percentage1rm ?? null,
        tempo: e.tempo ?? null,
        rest_seconds: e.restSeconds ?? null,
        is_warmup: e.isWarmup,
        notes: e.notes ?? null,
        set_specs: (e.setSpecs ?? null) as unknown as Json,
        video_url: e.videoUrl ?? null,
        prescribed_fields: e.prescribedFields,
      });
    });
  });
  return rows;
}
