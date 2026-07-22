import { supabaseAdmin } from "./supabase-admin";
import type { TrainingSession } from "@/types/training";
import { mapExerciseRow, mapSessionRow } from "./training-mappers";
import {
  bulkReplaceExercises,
  updateSurplusForFutureEvents,
} from "./training-session-service";
import type { ExerciseInput } from "./training-session-service";

export type ReplaceSessionInput = {
  name: string;
  focus?: string | null;
  estimatedDurationMinutes?: number | null;
  calorieSurplusPercentage?: number | null;
  notes?: string | null;
  exercises: ExerciseInput[];
};

export type ReplaceSessionResult = {
  session: TrainingSession;
  surplusChanged: boolean;
  identityChanged: boolean;
  futureEventsUpdated: number;
};

export type SessionEventLink = {
  id: string;
  date: string;
  status: string;
  isModified: boolean;
};

/**
 * The calendar events linked to one placed session, client-scoped. The tray
 * derives its shared-occurrence count (scope dialog) from these plus
 * clientToday, so the read must include past/non-scheduled events.
 */
export async function getSessionEventLinks(
  sessionId: string,
  clientId: string,
): Promise<SessionEventLink[]> {
  const { data, error } = await supabaseAdmin
    .from("training_events")
    .select("id, date, status, is_modified")
    .eq("training_session_id", sessionId)
    .eq("client_id", clientId)
    .order("date", { ascending: true });

  if (error) throw new Error(`Failed to fetch session events: ${error.message}`);

  return (data ?? []).map((e) => ({
    id: e.id,
    date: e.date,
    status: e.status,
    isModified: e.is_modified ?? false,
  }));
}

/**
 * Builder-grade full edit of a placed session: meta + the whole exercise list
 * (per-set specs and video included) in one call, with rename/surplus changes
 * propagated to FUTURE SCHEDULED events only — past events keep their
 * snapshotted name/focus/surplus, which is correct history.
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

  const nextFocus = input.focus ?? null;
  const nextSurplus = input.calorieSurplusPercentage ?? null;
  const surplusChanged = (current.calorie_surplus_percentage ?? null) !== nextSurplus;
  const identityChanged =
    current.name !== input.name || (current.focus ?? null) !== nextFocus;

  await bulkReplaceExercises(sessionId, input.exercises, coachId, clientId);

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

  let renamedCount = 0;
  if (identityChanged) {
    const { data: renamed, error: renameError } = await supabaseAdmin
      .from("training_events")
      .update({
        session_name: input.name,
        session_focus: nextFocus,
        updated_at: new Date().toISOString(),
      })
      .eq("training_session_id", sessionId)
      .eq("status", "scheduled")
      .gte("date", fromDate)
      .select("id");

    if (renameError) {
      throw new Error(`Failed to update future event snapshots: ${renameError.message}`);
    }
    renamedCount = renamed?.length ?? 0;
  }

  let surplusCount = 0;
  if (surplusChanged) {
    surplusCount = await updateSurplusForFutureEvents(sessionId, nextSurplus, fromDate);
  }

  const { data: exerciseRows, error: exercisesError } = await supabaseAdmin
    .from("training_exercises")
    .select("*")
    .eq("session_id", sessionId)
    .eq("is_active", true)
    .order("order_index", { ascending: true });

  if (exercisesError) {
    throw new Error(`Failed to read replaced exercises: ${exercisesError.message}`);
  }

  return {
    session: mapSessionRow(updatedRow, (exerciseRows ?? []).map(mapExerciseRow)),
    surplusChanged,
    identityChanged,
    // The rename and surplus predicates target the same future-scheduled set,
    // so when both ran the counts agree; max() covers the single-write cases.
    futureEventsUpdated: Math.max(renamedCount, surplusCount),
  };
}
