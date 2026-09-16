import { supabaseAdmin } from "./supabase-admin";
import type { TrainingSession } from "@/types/training";
import {
  EXERCISE_WITH_GROUP_COLUMNS,
  mapExerciseRowsToGroups,
  mapSessionRow,
  type TrainingExerciseWithGroupRow,
} from "./training-mappers";
import { resolveExercises } from "./exercise-catalog-service";
import {
  insertTrainingGroupRows,
  trainingGroupRowsFromInput,
  type TrainingGroupWrite,
} from "./training-group-writes";
import { sessionExercises } from "@/utils/exercise-groups";

/** A session's live exercises, read with the groups they sit in. */
export async function readActiveExerciseRows(
  sessionId: string,
): Promise<TrainingExerciseWithGroupRow[]> {
  const { data, error } = await supabaseAdmin
    .from("training_exercises")
    .select(EXERCISE_WITH_GROUP_COLUMNS)
    .eq("session_id", sessionId)
    .eq("is_active", true);
  if (error) throw new Error(`Failed to read the session's exercises: ${error.message}`);
  return (data ?? []) as unknown as TrainingExerciseWithGroupRow[];
}

/**
 * Write a session's new calorie_surplus_percentage onto its scheduled
 * training_events from `fromDate` — the placed day the session prescribes.
 *
 * Also sets is_modified=true, which marks the day edited on the calendar.
 *
 * Nutrition follows on its own: a day's target reads the surplus off the
 * event, so the days this touches re-price the moment the update lands.
 */
export async function updateSurplusForFutureEvents(
  sessionId: string,
  surplus: number | null,
  fromDate: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("training_events")
    .update({
      calorie_surplus_percentage: surplus,
      is_modified: true,
      updated_at: new Date().toISOString(),
    })
    .eq("training_session_id", sessionId)
    .gte("date", fromDate)
    .eq("status", "scheduled");

  if (error) throw new Error(`Failed to update future event surpluses: ${error.message}`);
}

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

  return mapSessionRow(sessionRow, mapExerciseRowsToGroups(await readActiveExerciseRows(sessionId)));
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
  groups: readonly TrainingGroupWrite[],
  coachId: string,
): Promise<Map<string, string>> {
  const unresolvedNames = sessionExercises({ groups })
    .filter((e) => !e.exerciseId)
    .map((e) => e.name);
  if (unresolvedNames.length === 0) return new Map();
  return resolveExercises(unresolvedNames, coachId);
}

// Replace all of a session's exercises, in their groups (insert new, then
// soft-delete old). A replaced exercise's group stays with it: a group is read
// through its live exercises, so nothing reads the old groups again.
export async function bulkReplaceExercises(
  sessionId: string,
  groups: TrainingGroupWrite[],
  coachId: string,
  clientId: string
): Promise<void> {
  // Verify the session belongs to a plan owned by this client (session -> plan
  // -> client_id). Defense in depth on top of the route's session-belongs-to-plan
  // check: this service is service-role and must never trust a bare sessionId,
  // or a foreign sessionId would be wiped.
  const { data: ownedSession } = await supabaseAdmin
    .from("training_sessions")
    .select("id, training_plans!inner(client_id)")
    .eq("id", sessionId)
    .eq("training_plans.client_id", clientId)
    .maybeSingle();

  if (!ownedSession) {
    throw new Error("Session not found");
  }

  // H3-class recoverability: capture the current rows, insert the new exercises
  // FIRST, then soft-delete the OLD ones by id. A failed/out-of-range insert (or
  // a hard timeout) throws before the delete, leaving the existing exercises
  // intact — worst case is duplicates cleared by a re-save, never an emptied
  // session (the old delete-then-insert did the opposite).
  const { data: oldRows, error: oldErr } = await supabaseAdmin
    .from("training_exercises")
    .select("id")
    .eq("session_id", sessionId)
    .eq("is_active", true);
  if (oldErr) throw new Error(`Failed to read existing exercises: ${oldErr.message}`);
  const oldIds = (oldRows ?? []).map((r) => r.id);

  // Insert the new groups and their exercises
  if (groups.length > 0) {
    const exerciseIdMap = await resolveMissingExerciseIds(groups, coachId);
    await insertTrainingGroupRows(trainingGroupRowsFromInput(sessionId, groups, exerciseIdMap));
  }

  // Soft-delete the previous rows by id (not by session — the new rows must stay).
  if (oldIds.length > 0) {
    const { error: deleteError } = await supabaseAdmin
      .from("training_exercises")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .in("id", oldIds);
    if (deleteError) throw new Error(`Failed to deactivate previous exercises: ${deleteError.message}`);
  }
}
