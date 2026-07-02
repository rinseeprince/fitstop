import { supabaseAdmin } from "./supabase-admin";
import type { AIGeneratedPlan } from "@/types/training";
import type {
  CoachSavedExerciseInsert,
  CoachSavedExerciseRow,
} from "@/lib/database-helpers";
import type { SetSpec } from "@/utils/exercise-set-specs";
import { projectExerciseCompact } from "@/utils/exercise-set-specs";

/**
 * Internal helpers shared across the coach saved-plan and saved-session
 * services. Extracted from the old coach-library-service.ts so the CRUD
 * split doesn't force one service to import from the other (which would
 * create a circular dependency the moment a function crossed the line).
 *
 * Not part of the public service surface — API routes should not import
 * from this file directly.
 */

/**
 * Fallback cycle detection when AI doesn't provide cycleLength/restDayPositions.
 * If sessions have dayOfWeek tags, derive a 7-day cycle with the unassigned
 * days becoming rest days. Otherwise fall back to "trainingDays + 1 rest at
 * the end" as a simple heuristic.
 */
export function detectCycleInfoFallback(
  sessions: AIGeneratedPlan["sessions"],
  _frequencyPerWeek: number | undefined,
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
        .filter((d) => d >= 0),
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

/**
 * Derive cycle_length / rest_pattern / frequency_per_week from an in-memory
 * session list. The whole program is the repeat unit, so cycle_length is the
 * total slot count across ALL weeks and rest_pattern is the 0-indexed rest slots
 * in (week_index, order_index) order. Sorts by (weekIndex, orderIndex) FIRST so an
 * out-of-order sessions array still lands the rest days at the right slots —
 * matching recomputePlanCycleInfo. weekIndex defaults to 0 so single-week / legacy
 * plans derive byte-identically to before. Shared by overwriteSavedPlan (library
 * save), recomputePlanCycleInfo, and the inline placement path so they never drift.
 *
 * frequency_per_week is a per-week AVERAGE clamped to 1..7: at apply time it is
 * inserted into training_plans.frequency_per_week, which carries
 * CHECK (frequency_per_week >= 1 AND <= 7) (migration 015) — a raw non-rest
 * total across a multi-week program (e.g. 12 for 3 weeks x 4/wk) would make the
 * placement RPC fail. Single-week plans derive identically to the pre-clamp
 * behaviour (weekCount = 1); all-rest programs clamp up to 1.
 */
export function deriveCycleInfoFromSessions(
  sessions: Array<{ weekIndex?: number; orderIndex: number; isRest: boolean }>,
): { cycleLength: number; restPattern: number[]; frequencyPerWeek: number } {
  const ordered = [...sessions].sort(
    (a, b) => (a.weekIndex ?? 0) - (b.weekIndex ?? 0) || a.orderIndex - b.orderIndex,
  );
  const cycleLength = ordered.length;
  const restPattern = ordered
    .map((s, i) => (s.isRest ? i : -1))
    .filter((i) => i >= 0);
  const weekCount =
    ordered.reduce((max, s) => Math.max(max, s.weekIndex ?? 0), 0) + 1;
  const nonRestCount = cycleLength - restPattern.length;
  const frequencyPerWeek = Math.min(
    7,
    Math.max(1, Math.round(nonRestCount / weekCount)),
  );
  return { cycleLength, restPattern, frequencyPerWeek };
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

/**
 * Batch-insert exercises for a saved session. Resolves exercise names to
 * canonical exercise_ids via the caller-supplied lookup map; an explicit
 * per-exercise `exerciseId` (already-resolved prescription, e.g. the
 * builder's create-blank payload) wins over the name lookup.
 */
export async function insertSavedExercises(
  sessionId: string,
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
  }>,
  exerciseIdMap: Map<string, string>,
): Promise<void> {
  if (exercises.length === 0) return;
  const rows: CoachSavedExerciseInsert[] = exercises.map((e, i) => {
    const w = projectExerciseCompact(e);
    return {
      saved_session_id: sessionId,
      exercise_id:
        e.exerciseId ?? exerciseIdMap.get(e.name.trim().toLowerCase()) ?? null,
      name: e.name,
      order_index: i,
      sets: w.sets,
      reps_min: w.reps_min,
      reps_max: w.reps_max,
      reps_target: e.repsTarget ?? null,
      rpe_target: e.rpeTarget ?? null,
      percentage_1rm: e.percentage1rm ?? null,
      tempo: e.tempo ?? null,
      rest_seconds: e.restSeconds ?? null,
      notes: e.notes ?? null,
      superset_group: e.supersetGroup ?? null,
      is_warmup: e.isWarmup ?? false,
      set_specs: w.set_specs,
      video_url: w.video_url,
    };
  });

  const { error } = await supabaseAdmin
    .from("coach_saved_exercises")
    .insert(rows);
  if (error) throw new Error(`Failed to insert saved exercises: ${error.message}`);
}

/**
 * Map existing coach_saved_exercises rows onto a new session as verbatim
 * copies — every prescription column including set_specs, video_url, and the
 * already-resolved exercise_id is carried as-is (no name re-resolution,
 * which could re-link or silently drop ids). Used by promote's
 * save-sessions-individually pass and the plan/session duplicate endpoints.
 */
export function copySavedExerciseRows(
  exercises: CoachSavedExerciseRow[],
  targetSessionId: string,
): CoachSavedExerciseInsert[] {
  return exercises.map((e) => ({
    saved_session_id: targetSessionId,
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
    set_specs: e.set_specs ?? null,
    video_url: e.video_url ?? null,
  }));
}

/**
 * Recompute cycle_length / rest_pattern / frequency_per_week on a saved
 * plan based on the current set of sessions. Called after any mutation
 * that changes the session list (add / delete / rest-day toggle / reorder)
 * so the plan's cycle metadata stays consistent with its sessions — the
 * calendar generator and the AI/manual initial-insert logic both assume
 * this invariant.
 */
export async function recomputePlanCycleInfo(
  planId: string,
  coachId: string,
): Promise<void> {
  const { data: sessions, error } = await supabaseAdmin
    .from("coach_saved_sessions")
    .select("is_rest, order_index, week_index")
    .eq("saved_plan_id", planId)
    .order("week_index", { ascending: true })
    .order("order_index", { ascending: true });
  if (error) throw new Error(`Failed to read sessions for cycle recompute: ${error.message}`);

  // Delegate to the shared derivation so the 1..7 frequency clamp (see
  // deriveCycleInfoFromSessions) applies here too — this value flows into the
  // CHECK-constrained training_plans.frequency_per_week at apply time.
  const { cycleLength, restPattern, frequencyPerWeek } = deriveCycleInfoFromSessions(
    (sessions ?? []).map((s) => ({
      weekIndex: s.week_index ?? 0,
      orderIndex: s.order_index,
      isRest: s.is_rest ?? false,
    })),
  );

  const { error: updateError } = await supabaseAdmin
    .from("coach_saved_plans")
    .update({
      cycle_length: cycleLength,
      rest_pattern: restPattern,
      frequency_per_week: frequencyPerWeek,
    })
    .eq("id", planId)
    .eq("coach_id", coachId);
  if (updateError) throw new Error(`Failed to update plan cycle info: ${updateError.message}`);
}
