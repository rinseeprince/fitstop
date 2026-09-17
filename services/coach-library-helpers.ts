import { supabaseAdmin } from "./supabase-admin";
import type {
  CoachSavedExerciseGroupInsert,
  CoachSavedExerciseGroupRow,
  CoachSavedExerciseInsert,
  CoachSavedExerciseRow,
  CoachSavedSessionInsert,
} from "@/lib/database-helpers";
import { chunkIds } from "@/lib/paged-fetch";
import type { SetSpec } from "@/utils/exercise-set-specs";
import { projectExerciseCompact } from "@/utils/exercise-set-specs";
import { groupSettingsToRow, type GroupSettingsInput } from "@/utils/exercise-groups";

/**
 * Internal helpers shared across the coach saved-plan and saved-session
 * services, kept separate so the CRUD
 * split doesn't force one service to import from the other (which would
 * create a circular dependency the moment a function crossed the line).
 *
 * Not part of the public service surface — API routes should not import
 * from this file directly.
 */

/**
 * Derive frequency_per_week from an in-memory session list. Shared by
 * overwriteSavedPlan (library save), recomputePlanFrequency, placement and the
 * plan editor's save so they never drift.
 *
 * frequency_per_week is the program's SESSIONS per week, averaged over its
 * weeks: a day can hold several sessions, so a week can hold more than seven
 * (migration 180 lifted the ceiling). A raw total across a multi-week program
 * (12 for 3 weeks x 4/wk) would read as 12 a week. An all-rest program reads 1:
 * training_plans.frequency_per_week is CHECK (>= 1).
 */
export function deriveFrequencyPerWeek(
  sessions: Array<{ weekIndex?: number; isRest: boolean }>,
): number {
  const weekCount =
    sessions.reduce((max, s) => Math.max(max, s.weekIndex ?? 0), 0) + 1;
  const nonRestCount = sessions.filter((s) => !s.isRest).length;
  return Math.max(1, Math.round(nonRestCount / weekCount));
}

/**
 * Resolve a name collision with the library's " (copy N)" RENAME convention.
 * Returns `desired` untouched when free; otherwise caps the base at 88 chars
 * (so "base (copy NN)" stays inside the 100-char name schemas) and appends
 * " (copy)", " (copy 2)", ... Matching is lowercased-trimmed; `takenLower`
 * must already be lowercased+trimmed. Used by the plan/session duplicate
 * endpoints and save-day-as-workout — NOT by promoteDraftToSaved, whose
 * standalone-session pass deliberately SKIPS on conflict instead of renaming.
 */
export function dedupeCopyName(desired: string, takenLower: Set<string>): string {
  if (!takenLower.has(desired.trim().toLowerCase())) return desired;
  const base = desired.length > 88 ? desired.slice(0, 88) : desired;
  let name = `${base} (copy)`;
  for (let n = 2; takenLower.has(name.trim().toLowerCase()); n++) {
    name = `${base} (copy ${n})`;
  }
  return name;
}

/** Rows per INSERT statement: a whole program's groups can run to thousands. */
const INSERT_CHUNK = 500;

/** One exercise on its way into a library session. */
export type SavedExerciseWrite = {
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
  isWarmup?: boolean;
  setSpecs?: SetSpec[] | null;
  videoUrl?: string | null;
  prescribedFields?: readonly string[] | null;
};

/** One group on its way into a library session: its settings and its exercises, in order. */
export type SavedGroupWrite = GroupSettingsInput & { exercises: SavedExerciseWrite[] };

/** A library session's groups and exercises as rows, groups first. */
export type SavedGroupRows = {
  groups: CoachSavedExerciseGroupInsert[];
  exercises: CoachSavedExerciseInsert[];
};

/** A group row read with its exercises (the embed every library read uses). */
type SavedGroupRowTree = CoachSavedExerciseGroupRow & {
  coach_saved_exercises?: CoachSavedExerciseRow[] | null;
};

/**
 * The rows that write `groups` into a library session. Positions are array
 * places: a group's order_index is its place in the session, an exercise's its
 * place in its group. Group ids are minted here so every exercise row names its
 * group before anything is written — no read-back to match rows up. Resolves
 * exercise names to catalog ids through the caller's lookup map; an explicit
 * `exerciseId` (an already-resolved prescription) wins over the name lookup.
 */
export function savedGroupRowsFromInput(
  sessionId: string,
  groups: readonly SavedGroupWrite[],
  exerciseIdMap: Map<string, string>,
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
      const w = projectExerciseCompact(e);
      rows.exercises.push({
        saved_session_id: sessionId,
        group_id: groupId,
        exercise_id:
          e.exerciseId ?? exerciseIdMap.get(e.name.trim().toLowerCase()) ?? null,
        name: e.name,
        order_index: exerciseIndex,
        sets: w.sets,
        reps_min: w.reps_min,
        reps_max: w.reps_max,
        reps_target: e.repsTarget ?? null,
        rpe_target: e.rpeTarget ?? null,
        percentage_1rm: e.percentage1rm ?? null,
        tempo: e.tempo ?? null,
        rest_seconds: e.restSeconds ?? null,
        notes: e.notes ?? null,
        is_warmup: e.isWarmup ?? false,
        set_specs: w.set_specs,
        video_url: w.video_url,
        prescribed_fields: w.prescribed_fields,
      });
    });
  });
  return rows;
}

/**
 * Library group rows (read with their exercises) as verbatim copies under
 * another session — every group setting and position, and every exercise
 * column including set_specs, video_url, prescribed_fields and the
 * already-resolved exercise_id, carried as-is (no name re-resolution, which
 * could re-link or silently drop ids). Fresh group ids, so the copy shares no
 * row with its source. Used by promote's save-sessions-individually pass, the
 * plan duplicate and the standalone session's snapshot restore.
 */
export function copySavedGroupRows(
  groups: readonly SavedGroupRowTree[],
  targetSessionId: string,
): SavedGroupRows {
  const rows: SavedGroupRows = { groups: [], exercises: [] };
  for (const group of groups) {
    const groupId = crypto.randomUUID();
    rows.groups.push({
      id: groupId,
      saved_session_id: targetSessionId,
      order_index: group.order_index,
      format: group.format,
      rounds: group.rounds,
      time_cap_seconds: group.time_cap_seconds,
      interval_seconds: group.interval_seconds,
      rest_between_exercises_seconds: group.rest_between_exercises_seconds,
      rest_between_rounds_seconds: group.rest_between_rounds_seconds,
      notes: group.notes,
    });
    for (const e of group.coach_saved_exercises ?? []) {
      rows.exercises.push({
        saved_session_id: targetSessionId,
        group_id: groupId,
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
        is_warmup: e.is_warmup,
        notes: e.notes,
        set_specs: e.set_specs ?? null,
        video_url: e.video_url ?? null,
        prescribed_fields: e.prescribed_fields ?? null,
      });
    }
  }
  return rows;
}

/** Merge several sessions' rows into one pair of batches. */
export function concatSavedGroupRows(parts: readonly SavedGroupRows[]): SavedGroupRows {
  return {
    groups: parts.flatMap((part) => part.groups),
    exercises: parts.flatMap((part) => part.exercises),
  };
}

/**
 * Write library group rows: the groups, then the exercises that sit in them
 * (an exercise's foreign key names its group, so the groups land first).
 * Chunked, so a whole program is a handful of statements, never one per row.
 * Not a transaction: a failure between the two leaves groups with no
 * exercises, which every caller removes with the session they belong to.
 */
export async function insertSavedGroupRows(rows: SavedGroupRows): Promise<void> {
  for (let from = 0; from < rows.groups.length; from += INSERT_CHUNK) {
    const { error } = await supabaseAdmin
      .from("coach_saved_exercise_groups")
      .insert(rows.groups.slice(from, from + INSERT_CHUNK));
    if (error) throw new Error(`Failed to insert saved exercise groups: ${error.message}`);
  }
  for (let from = 0; from < rows.exercises.length; from += INSERT_CHUNK) {
    const { error } = await supabaseAdmin
      .from("coach_saved_exercises")
      .insert(rows.exercises.slice(from, from + INSERT_CHUNK));
    if (error) throw new Error(`Failed to insert saved exercises: ${error.message}`);
  }
}

/**
 * Write a program's session rows — ids minted by the caller, so each row's
 * groups name it before anything is written and nothing is matched back from
 * `RETURNING`. Chunked: a program's days can hold several sessions each, so a
 * long program runs to a few thousand rows, a few statements rather than one
 * round trip per row.
 */
export async function insertSavedSessionRows(
  rows: readonly (CoachSavedSessionInsert & { id: string })[],
): Promise<void> {
  for (let from = 0; from < rows.length; from += INSERT_CHUNK) {
    const { error } = await supabaseAdmin
      .from("coach_saved_sessions")
      .insert(rows.slice(from, from + INSERT_CHUNK));
    if (error) throw new Error(`Failed to insert saved sessions: ${error.message}`);
  }
}

/**
 * Delete library sessions by id, in chunks that keep each `.in()` filter under
 * the request-line ceiling; their groups and exercises cascade.
 */
export async function deleteSavedSessions(ids: readonly string[]): Promise<void> {
  for (const chunk of chunkIds([...ids])) {
    const { error } = await supabaseAdmin.from("coach_saved_sessions").delete().in("id", chunk);
    if (error) throw new Error(`Failed to delete saved sessions: ${error.message}`);
  }
}

/** Write `groups` into one library session. */
export async function insertSavedGroups(
  sessionId: string,
  groups: readonly SavedGroupWrite[],
  exerciseIdMap: Map<string, string>,
): Promise<void> {
  await insertSavedGroupRows(savedGroupRowsFromInput(sessionId, groups, exerciseIdMap));
}

/**
 * Recompute frequency_per_week on a saved plan based on the current set of
 * sessions. Called after any mutation that changes the session list (add /
 * delete / rest-day toggle / reorder) so the plan's frequency stays consistent
 * with its sessions.
 */
export async function recomputePlanFrequency(
  planId: string,
  coachId: string,
): Promise<void> {
  const { data: sessions, error } = await supabaseAdmin
    .from("coach_saved_sessions")
    .select("is_rest, week_index")
    .eq("saved_plan_id", planId);
  if (error) throw new Error(`Failed to read sessions for frequency recompute: ${error.message}`);

  // Delegate to the shared derivation so this path counts sessions per week
  // exactly as the save and placement do (see deriveFrequencyPerWeek).
  const frequencyPerWeek = deriveFrequencyPerWeek(
    (sessions ?? []).map((s) => ({
      weekIndex: s.week_index ?? 0,
      isRest: s.is_rest ?? false,
    })),
  );

  const { error: updateError } = await supabaseAdmin
    .from("coach_saved_plans")
    .update({ frequency_per_week: frequencyPerWeek })
    .eq("id", planId)
    .eq("coach_id", coachId);
  if (updateError) throw new Error(`Failed to update plan frequency: ${updateError.message}`);
}
