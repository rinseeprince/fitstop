import { supabaseAdmin } from "./supabase-admin";
import { resolveExercises } from "./exercise-catalog-service";
import {
  SAVED_SESSION_GROUPS_EMBED,
  mapSavedSessionTree,
  type SavedSessionTreeRow,
} from "@/lib/coach-mappers";
import {
  copySavedGroupRows,
  dedupeCopyName,
  insertSavedGroupRows,
  insertSavedGroups,
  type SavedGroupWrite,
} from "./coach-library-helpers";
import { sessionExercises } from "@/utils/exercise-groups";
import type { SavedSession } from "@/types/training";

// STANDALONE saved sessions (coach_saved_sessions with saved_plan_id NULL) —
// the reusable-workout library. Split out of coach-saved-session-service.ts
// (which keeps the plan-attached session/exercise CRUD) along the existing
// "--- Standalone session ---" seam.

type StandaloneSessionInput = {
  name: string;
  focus?: string | null;
  estimatedDurationMinutes?: number | null;
  calorieSurplusPercentage?: number | null;
  notes?: string | null;
  groups: SavedGroupWrite[];
};

/**
 * Client-supplied exerciseIds are validated against the coach's visible
 * catalog (own + global) — a foreign coach's id (or a stale one) is nulled
 * out and falls back to name resolution rather than linking cross-tenant.
 */
async function nullifyForeignExerciseIds(
  coachId: string,
  groups: SavedGroupWrite[],
): Promise<SavedGroupWrite[]> {
  const explicitIds = [
    ...new Set(
      groups
        .flatMap((group) => group.exercises)
        .map((e) => e.exerciseId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  if (explicitIds.length === 0) return groups;

  const { data: rows, error: idError } = await supabaseAdmin
    .from("exercises")
    .select("id")
    .in("id", explicitIds)
    .or(`coach_id.eq.${coachId},coach_id.is.null`);
  if (idError) {
    throw new Error(`Failed to validate exercise ids: ${idError.message}`);
  }
  const visibleIds = new Set((rows ?? []).map((r) => r.id));
  return groups.map((group) => ({
    ...group,
    exercises: group.exercises.map((e) =>
      e.exerciseId && !visibleIds.has(e.exerciseId)
        ? { ...e, exerciseId: null }
        : e
    ),
  }));
}

// Note: the input carries no sessionType and the insert hardcodes
// session_type "training" — immaterial today (the TS union is
// 'training'-only), but save-day-as-workout would relabel a future
// non-training session.
export async function createStandaloneSession(
  coachId: string,
  data: StandaloneSessionInput
): Promise<string> {
  const groups = await nullifyForeignExerciseIds(coachId, data.groups);

  // Only unresolved names need the lookup; explicit exerciseIds win inside
  // insertSavedGroups (never create catalog rows for already-linked
  // prescriptions).
  const exerciseNames = sessionExercises({ groups })
    .filter((e) => !e.exerciseId)
    .map((e) => e.name);
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
    await insertSavedGroups(session.id, groups, exerciseIdMap);
  } catch (insertError) {
    // No shell sessions in the library: a failed group or exercise insert
    // removes the just-created row (its groups cascade) before rethrowing.
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
    .select(`*, ${SAVED_SESSION_GROUPS_EMBED}`)
    .eq("coach_id", coachId)
    .is("saved_plan_id", null)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch standalone sessions: ${error.message}`);

  return ((data ?? []) as SavedSessionTreeRow[]).map(mapSavedSessionTree);
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
    .select(`*, ${SAVED_SESSION_GROUPS_EMBED}`)
    .eq("id", sessionId)
    .eq("coach_id", coachId)
    .is("saved_plan_id", null)
    .single();
  if (fetchError || !existing) throw new Error("Session not found");

  const snapshot = (existing as SavedSessionTreeRow).coach_saved_exercise_groups ?? [];

  // Read-only prep before the first destructive write.
  const groups = await nullifyForeignExerciseIds(coachId, input.groups);
  const exerciseNames = sessionExercises({ groups })
    .filter((e) => !e.exerciseId)
    .map((e) => e.name);
  const exerciseIdMap = await resolveExercises(exerciseNames, coachId);

  // Verbatim CLONE restore of the pre-call children (group settings, set_specs
  // / video_url / exercise_id carried as-is — no re-resolution).
  const restoreSnapshot = async (): Promise<void> => {
    if (snapshot.length === 0) return;
    try {
      await insertSavedGroupRows(copySavedGroupRows(snapshot, sessionId));
    } catch (restoreError) {
      const restoreMsg =
        restoreError instanceof Error ? restoreError.message : String(restoreError);
      throw new Error(`restore also failed: ${restoreMsg}`);
    }
  };

  // Deleting the groups takes their exercises with them.
  const { error: deleteError } = await supabaseAdmin
    .from("coach_saved_exercise_groups")
    .delete()
    .eq("saved_session_id", sessionId);
  if (deleteError) {
    throw new Error(`Failed to replace exercises: ${deleteError.message}`);
  }

  try {
    await insertSavedGroups(sessionId, groups, exerciseIdMap);
  } catch (insertError) {
    const insertMsg =
      insertError instanceof Error ? insertError.message : String(insertError);
    // A failure between the groups and their exercises leaves the groups
    // behind: clear the session's children before restoring the snapshot, or
    // the restored groups would sit beside empty ones.
    const { error: clearError } = await supabaseAdmin
      .from("coach_saved_exercise_groups")
      .delete()
      .eq("saved_session_id", sessionId);
    if (clearError) {
      throw new Error(`${insertMsg}; restore also failed: ${clearError.message}`);
    }
    // A failing restore must never shadow the root cause — combine both
    // (same contract as the update-failure path below).
    try {
      await restoreSnapshot();
    } catch (restoreError) {
      const restoreMsg =
        restoreError instanceof Error ? restoreError.message : String(restoreError);
      throw new Error(`${insertMsg}; ${restoreMsg}`);
    }
    throw insertError;
  }

  const { error: updateError } = await supabaseAdmin
    .from("coach_saved_sessions")
    .update({
      // Full-replace semantics: absent optional clears (?? null) — never a
      // merge-style conditional spread that would keep the stored value.
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
      .from("coach_saved_exercise_groups")
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
