import { supabaseAdmin } from "./supabase-admin";
import type { AIGeneratedPlan } from "@/types/training";
import type { CoachSavedExerciseInsert } from "@/lib/database-helpers";

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
 * Batch-insert exercises for a saved session. Resolves exercise names to
 * canonical exercise_ids via the caller-supplied lookup map.
 */
export async function insertSavedExercises(
  sessionId: string,
  exercises: Array<{
    name: string;
    sets: number;
    repsMin?: number;
    repsMax?: number;
    repsTarget?: string;
    rpeTarget?: number;
    percentage1rm?: number;
    tempo?: string;
    restSeconds?: number;
    notes?: string;
    supersetGroup?: string;
    isWarmup?: boolean;
  }>,
  exerciseIdMap: Map<string, string>,
): Promise<void> {
  if (exercises.length === 0) return;
  const rows: CoachSavedExerciseInsert[] = exercises.map((e, i) => ({
    saved_session_id: sessionId,
    exercise_id: exerciseIdMap.get(e.name.trim().toLowerCase()) ?? null,
    name: e.name,
    order_index: i,
    sets: e.sets,
    reps_min: e.repsMin ?? null,
    reps_max: e.repsMax ?? null,
    reps_target: e.repsTarget ?? null,
    rpe_target: e.rpeTarget ?? null,
    percentage_1rm: e.percentage1rm ?? null,
    tempo: e.tempo ?? null,
    rest_seconds: e.restSeconds ?? null,
    notes: e.notes ?? null,
    superset_group: e.supersetGroup ?? null,
    is_warmup: e.isWarmup ?? false,
  }));

  const { error } = await supabaseAdmin
    .from("coach_saved_exercises")
    .insert(rows);
  if (error) throw new Error(`Failed to insert saved exercises: ${error.message}`);
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
    .select("is_rest, order_index")
    .eq("saved_plan_id", planId)
    .order("order_index", { ascending: true });
  if (error) throw new Error(`Failed to read sessions for cycle recompute: ${error.message}`);

  const cycleLength = sessions?.length ?? 0;
  const restPattern = (sessions ?? [])
    .map((s, i) => (s.is_rest ? i : -1))
    .filter((i) => i >= 0);
  const trainingCount = cycleLength - restPattern.length;

  const { error: updateError } = await supabaseAdmin
    .from("coach_saved_plans")
    .update({
      cycle_length: cycleLength,
      rest_pattern: restPattern,
      frequency_per_week: trainingCount,
    })
    .eq("id", planId)
    .eq("coach_id", coachId);
  if (updateError) throw new Error(`Failed to update plan cycle info: ${updateError.message}`);
}
