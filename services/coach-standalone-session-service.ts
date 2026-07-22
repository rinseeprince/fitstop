import { supabaseAdmin } from "./supabase-admin";
import { resolveExercises } from "./exercise-catalog-service";
import type { SetSpec } from "@/utils/exercise-set-specs";
import {
  mapSavedExerciseRow,
  mapSavedSessionRow,
} from "@/lib/coach-mappers";
import {
  copySavedExerciseRows,
  dedupeCopyName,
  insertSavedExercises,
} from "./coach-library-helpers";
import type { SavedSession } from "@/types/training";
import type {
  CoachSavedSessionRow,
  CoachSavedExerciseRow,
} from "@/lib/database-helpers";

// STANDALONE saved sessions (coach_saved_sessions with saved_plan_id NULL) —
// the reusable-workout library. Split out of coach-saved-session-service.ts
// (which keeps the plan-attached session/exercise CRUD) along the existing
// "--- Standalone session ---" seam.

export type StandaloneSessionInput = {
  name: string;
  focus?: string | null;
  estimatedDurationMinutes?: number | null;
  calorieSurplusPercentage?: number | null;
  notes?: string | null;
  exercises: Array<{
    name: string;
    exerciseId?: string | null;
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
    setSpecs?: SetSpec[] | null;
    videoUrl?: string | null;
  }>;
};

/**
 * Client-supplied exerciseIds are validated against the coach's visible
 * catalog (own + global) — a foreign coach's id (or a stale one) is nulled
 * out and falls back to name resolution rather than linking cross-tenant.
 */
async function nullifyForeignExerciseIds<T extends { exerciseId?: string | null }>(
  coachId: string,
  exercises: T[],
): Promise<T[]> {
  const explicitIds = [
    ...new Set(
      exercises
        .map((e) => e.exerciseId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  if (explicitIds.length === 0) return exercises;

  const { data: rows, error: idError } = await supabaseAdmin
    .from("exercises")
    .select("id")
    .in("id", explicitIds)
    .or(`coach_id.eq.${coachId},coach_id.is.null`);
  if (idError) {
    throw new Error(`Failed to validate exercise ids: ${idError.message}`);
  }
  const visibleIds = new Set((rows ?? []).map((r) => r.id));
  return exercises.map((e) =>
    e.exerciseId && !visibleIds.has(e.exerciseId)
      ? { ...e, exerciseId: null }
      : e
  );
}

// Note: the input carries no sessionType and the insert hardcodes
// session_type "training" — immaterial today (the TS union is
// 'training'-only), but save-day-as-workout would relabel a future
// non-training session.
export async function createStandaloneSession(
  coachId: string,
  data: StandaloneSessionInput
): Promise<string> {
  const exercises = await nullifyForeignExerciseIds(coachId, data.exercises);

  // Only unresolved names need the lookup; explicit exerciseIds win inside
  // insertSavedExercises (never create catalog rows for already-linked
  // prescriptions).
  const exerciseNames = exercises.filter((e) => !e.exerciseId).map((e) => e.name);
  const exerciseIdMap = await resolveExercises(exerciseNames, coachId);

  const { data: session, error } = await supabaseAdmin
    .from("coach_saved_sessions")
    .insert({
      coach_id: coachId,
      saved_plan_id: null,
      name: data.name,
      focus: data.focus ?? null,
      order_index: 0,
      week_index: 0,
      is_rest: false,
      estimated_duration_minutes: data.estimatedDurationMinutes ?? null,
      calorie_surplus_percentage: data.calorieSurplusPercentage ?? null,
      notes: data.notes ?? null,
      session_type: "training",
    })
    .select("id")
    .single();
  if (error || !session) throw new Error(`Failed to create standalone session: ${error?.message}`);

  try {
    await insertSavedExercises(session.id, exercises, exerciseIdMap);
  } catch (insertError) {
    // No shell sessions in the library: a failed exercise insert removes the
    // just-created row before rethrowing.
    await supabaseAdmin
      .from("coach_saved_sessions")
      .delete()
      .eq("id", session.id)
      .eq("coach_id", coachId);
    throw insertError;
  }
  return session.id;
}

/**
 * Create with server-side " (copy N)" rename on name conflict — the builder's
 * save-day-as-workout path, where the coach never typed the name. Returns the
 * final name so the UI can surface the rename.
 */
export async function createStandaloneSessionDeduped(
  coachId: string,
  data: StandaloneSessionInput,
): Promise<{ sessionId: string; name: string }> {
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
  const name = dedupeCopyName(data.name, taken);
  const sessionId = await createStandaloneSession(coachId, { ...data, name });
  return { sessionId, name };
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
/**
 * Full replace of a STANDALONE session — fields + exercises — the Sessions
 * page editor's save. Ordered so ANY failure leaves the session in its
 * pre-call state: the snapshot is taken first, all reads happen before the
 * first destructive write, the child swap restores the snapshot on failure,
 * and a failed final field-update unwinds the child swap too (the fields
 * themselves were never written if that UPDATE failed). Best-effort — there
 * is no transaction without an RPC. (overwriteSavedPlan uses the same class of
 * best-effort recovery: insert-new-first, delete-old-after, metadata last.)
 */
export async function overwriteStandaloneSession(
  sessionId: string,
  coachId: string,
  input: StandaloneSessionInput,
): Promise<void> {
  // Ownership + standalone scope + pre-call children in one query. The bare
  // "Session not found" string is the route's 404 contract (strict equality,
  // like the duplicate route) — do not template details into it.
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from("coach_saved_sessions")
    .select("*, coach_saved_exercises(*)")
    .eq("id", sessionId)
    .eq("coach_id", coachId)
    .is("saved_plan_id", null)
    .single();
  if (fetchError || !existing) throw new Error("Session not found");

  const snapshot = (existing.coach_saved_exercises ?? []) as CoachSavedExerciseRow[];

  // Read-only prep before the first destructive write.
  const exercises = await nullifyForeignExerciseIds(coachId, input.exercises);
  const exerciseNames = exercises.filter((e) => !e.exerciseId).map((e) => e.name);
  const exerciseIdMap = await resolveExercises(exerciseNames, coachId);

  // Verbatim CLONE restore of the pre-call children (set_specs / video_url /
  // exercise_id carried as-is — no re-resolution).
  const restoreSnapshot = async (): Promise<void> => {
    if (snapshot.length === 0) return;
    const { error: restoreError } = await supabaseAdmin
      .from("coach_saved_exercises")
      .insert(copySavedExerciseRows(snapshot, sessionId));
    if (restoreError) {
      throw new Error(`restore also failed: ${restoreError.message}`);
    }
  };

  const { error: deleteError } = await supabaseAdmin
    .from("coach_saved_exercises")
    .delete()
    .eq("saved_session_id", sessionId);
  if (deleteError) {
    throw new Error(`Failed to replace exercises: ${deleteError.message}`);
  }

  try {
    await insertSavedExercises(sessionId, exercises, exerciseIdMap);
  } catch (insertError) {
    // A failing restore must never shadow the root cause — combine both
    // (same contract as the update-failure path below).
    try {
      await restoreSnapshot();
    } catch (restoreError) {
      const insertMsg =
        insertError instanceof Error ? insertError.message : String(insertError);
      const restoreMsg =
        restoreError instanceof Error ? restoreError.message : String(restoreError);
      throw new Error(`${insertMsg}; ${restoreMsg}`);
    }
    throw insertError;
  }

  const { error: updateError } = await supabaseAdmin
    .from("coach_saved_sessions")
    .update({
      // Full-replace semantics: absent optional clears (?? null), never the
      // merge-style conditional spread of updateSavedSession.
      name: input.name,
      focus: input.focus ?? null,
      estimated_duration_minutes: input.estimatedDurationMinutes ?? null,
      calorie_surplus_percentage: input.calorieSurplusPercentage ?? null,
      notes: input.notes ?? null,
      // Standalone sessions aren't slotted into a program, so their position
      // is always 0/0 — a stale index here would be meaningless anywhere it
      // was later inserted.
      order_index: 0,
      week_index: 0,
      is_rest: false,
    })
    .eq("id", sessionId)
    .eq("coach_id", coachId);
  if (updateError) {
    // Unwind the child swap so the whole call is all-or-nothing: delete the
    // just-inserted rows, restore the snapshot. Restore failures append to —
    // never shadow — the update error.
    const { error: unwindError } = await supabaseAdmin
      .from("coach_saved_exercises")
      .delete()
      .eq("saved_session_id", sessionId);
    if (unwindError) {
      throw new Error(
        `Failed to update session: ${updateError.message}; restore also failed: ${unwindError.message}`
      );
    }
    try {
      await restoreSnapshot();
    } catch (restoreError) {
      const restoreMsg =
        restoreError instanceof Error ? restoreError.message : String(restoreError);
      throw new Error(
        `Failed to update session: ${updateError.message}; ${restoreMsg}`
      );
    }
    throw new Error(`Failed to update session: ${updateError.message}`);
  }
}
