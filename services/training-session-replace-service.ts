import { supabaseAdmin } from "./supabase-admin";
import type { TrainingSession } from "@/types/training";
import { mapExerciseRowsToGroups, mapSessionRow } from "./training-mappers";
import {
  bulkReplaceExercises,
  readActiveExerciseRows,
  updateSurplusForFutureEvents,
} from "./training-session-service";
import type { TrainingGroupWrite } from "./training-group-writes";
import { assertSessionUnlogged } from "./training-event-occupancy";

type ReplaceSessionInput = {
  name: string;
  focus?: string | null;
  estimatedDurationMinutes?: number | null;
  calorieSurplusPercentage?: number | null;
  notes?: string | null;
  groups: TrainingGroupWrite[];
};

type ReplaceSessionResult = {
  session: TrainingSession;
};

/**
 * Builder-grade full edit of a placed session: meta + the whole exercise list
 * (per-set specs and video included) in one call, with rename/surplus changes
 * written to the session's scheduled events from `fromDate` — the placed day
 * it prescribes; a past day keeps its snapshotted name/focus/surplus, which is
 * correct history.
 *
 * Every step is idempotent, so a retried save repairs any partial write; no
 * compensator is needed at this blast radius (one session's rows + its future
 * event snapshots).
 */
export async function replaceSessionFull(params: {
  sessionId: string;
  planId: string;
  clientId: string;
  coachId: string;
  /** The client-local today floor for the future-events writes. */
  fromDate: string;
  input: ReplaceSessionInput;
}): Promise<ReplaceSessionResult> {
  const { sessionId, planId, clientId, coachId, fromDate, input } = params;

  // Ownership via the session -> plan -> client inner join (the
  // bulkReplaceExercises idiom), additionally pinned to the plan in the URL so
  // a cross-plan sessionId cannot be rewritten through another plan's route.
  const { data: current, error: readError } = await supabaseAdmin
    .from("training_sessions")
    .select("*, training_plans!inner(client_id)")
    .eq("id", sessionId)
    .eq("plan_id", planId)
    .eq("is_active", true)
    .eq("training_plans.client_id", clientId)
    .maybeSingle();

  if (readError) throw new Error(`Failed to read session: ${readError.message}`);
  if (!current) throw new Error("Session not found");
  if (current.is_rest) throw new Error("Rest days cannot be edited");

  // The exercise rewrite below is what a logged day has to be protected from:
  // bulkReplaceExercises soft-deletes the rows the client's exercise_logs point
  // at and inserts replacements with new ids. Ownership is proven above, so a
  // foreign sessionId still reads as not found rather than as locked.
  await assertSessionUnlogged(sessionId, clientId);

  const nextFocus = input.focus ?? null;
  const nextSurplus = input.calorieSurplusPercentage ?? null;
  const surplusChanged = (current.calorie_surplus_percentage ?? null) !== nextSurplus;
  const identityChanged =
    current.name !== input.name || (current.focus ?? null) !== nextFocus;

  await bulkReplaceExercises(sessionId, input.groups, coachId, clientId);

  const { data: updatedRow, error: updateError } = await supabaseAdmin
    .from("training_sessions")
    .update({
      name: input.name,
      focus: nextFocus,
      estimated_duration_minutes: input.estimatedDurationMinutes ?? null,
      calorie_surplus_percentage: nextSurplus,
      notes: input.notes ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .select()
    .single();

  if (updateError || !updatedRow) {
    throw new Error(`Failed to update session: ${updateError?.message ?? "no row returned"}`);
  }

  if (identityChanged) {
    const { error: renameError } = await supabaseAdmin
      .from("training_events")
      .update({
        session_name: input.name,
        session_focus: nextFocus,
        updated_at: new Date().toISOString(),
      })
      .eq("training_session_id", sessionId)
      .eq("status", "scheduled")
      .gte("date", fromDate);

    if (renameError) {
      throw new Error(`Failed to update future event snapshots: ${renameError.message}`);
    }
  }

  if (surplusChanged) {
    await updateSurplusForFutureEvents(sessionId, nextSurplus, fromDate);
  }

  const exerciseRows = await readActiveExerciseRows(sessionId);

  return {
    session: mapSessionRow(updatedRow, mapExerciseRowsToGroups(exerciseRows)),
  };
}
