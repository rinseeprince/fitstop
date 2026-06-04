import { supabaseAdmin } from "./supabase-admin";
import { calculateEpleyE1RM } from "@/utils/exercise-analytics-helpers";
import type {
  ExerciseListItem,
  ExerciseProgressionPoint,
  ExercisePR,
} from "@/types/training";

// ---------------------------------------------------------------------------
// Public API — backed by SQL RPCs (migration 094). Identity-union + windowing
// + group aggregates live in Postgres; per-set math stays in JS over the
// bounded RPC result.
// ---------------------------------------------------------------------------

export async function getClientExerciseList(
  clientId: string,
  opts: { startDate?: string; endDate?: string } = {}
): Promise<ExerciseListItem[]> {
  // Omitting (undefined) the date params falls through to the RPC's DEFAULT NULL
  // bounds (migration 102) → unbounded. No cast needed: `string | undefined`
  // matches the gen-types optional param exactly.
  const { data, error } = await supabaseAdmin.rpc("get_client_exercise_list", {
    p_client_id: clientId,
    p_start_date: opts.startDate,
    p_end_date: opts.endDate,
  });
  if (error) {
    throw new Error(`Failed to fetch exercise list: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    exerciseId: row.exercise_id ?? null,
    name: row.name ?? "Unknown exercise",
    logCount: Number(row.log_count),
    lastLoggedDate: row.last_logged_date,
  }));
}

export async function getExerciseProgressionSeries(
  clientId: string,
  opts: {
    exerciseId?: string;
    exerciseName?: string;
    sessionCount?: number;
    startDate?: string;
    endDate?: string;
  }
): Promise<ExerciseProgressionPoint[]> {
  const { data, error } = await supabaseAdmin.rpc(
    "get_exercise_progression_window",
    {
      p_client_id: clientId,
      p_exercise_id: opts.exerciseId,
      p_exercise_name: opts.exerciseName,
      // Omitting p_session_count (undefined) is load-bearing: the RPC's
      // DEFAULT NULL (migration 103) lets the window-aware COALESCE own the cap —
      // no window → floors to 12; a date window → uncapped within the window.
      // Passing 12 here would silently re-cap every phase/program chart.
      p_session_count: opts.sessionCount,
      p_start_date: opts.startDate,
      p_end_date: opts.endDate,
    }
  );
  if (error) {
    throw new Error(`Failed to fetch exercise progression: ${error.message}`);
  }

  type SetRow = {
    reps: number | null;
    weight: number | null;
    rpe: number | null;
  };
  type SessionGroup = {
    completedAt: string;
    snapshot: Record<string, unknown> | null;
    sets: SetRow[];
  };

  const groups = new Map<string, SessionGroup>();

  for (const row of data ?? []) {
    let group = groups.get(row.session_log_id);
    if (!group) {
      group = {
        completedAt: row.completed_at,
        snapshot:
          (row.prescribed_exercise_snapshot as Record<string, unknown> | null) ??
          null,
        sets: [],
      };
      groups.set(row.session_log_id, group);
    }
    if (row.set_id !== null && row.set_id !== undefined) {
      group.sets.push({
        reps: row.reps,
        weight: row.weight !== null ? Number(row.weight) : null,
        rpe: row.rpe !== null ? Number(row.rpe) : null,
      });
    }
  }

  const points: ExerciseProgressionPoint[] = [];

  for (const [sessionLogId, group] of groups) {
    // Top set: highest weight, tiebreak by highest reps
    let topSetWeight: number | null = null;
    let topSetReps: number | null = null;
    let topSetRpe: number | null = null;
    for (const s of group.sets) {
      if (s.weight == null) continue;
      if (
        topSetWeight == null ||
        s.weight > topSetWeight ||
        (s.weight === topSetWeight && (s.reps ?? 0) > (topSetReps ?? 0))
      ) {
        topSetWeight = s.weight;
        topSetReps = s.reps;
        topSetRpe = s.rpe;
      }
    }

    // Total volume: SUM(reps * weight) for sets with both values
    let totalVolume: number | null = null;
    for (const s of group.sets) {
      if (s.reps != null && s.weight != null) {
        totalVolume = (totalVolume ?? 0) + s.reps * s.weight;
      }
    }

    // Best estimated 1RM across all sets
    let estimatedOneRepMax: number | null = null;
    for (const s of group.sets) {
      if (s.reps != null && s.weight != null) {
        const e1rm = calculateEpleyE1RM(s.weight, s.reps);
        if (
          e1rm != null &&
          (estimatedOneRepMax == null || e1rm > estimatedOneRepMax)
        ) {
          estimatedOneRepMax = e1rm;
        }
      }
    }

    const snapshot = group.snapshot;
    const prescribedSets =
      snapshot && typeof snapshot.sets === "number" ? snapshot.sets : null;
    const prescribedRepsMin =
      snapshot && typeof snapshot.reps_min === "number"
        ? snapshot.reps_min
        : null;
    const prescribedRepsMax =
      snapshot && typeof snapshot.reps_max === "number"
        ? snapshot.reps_max
        : null;

    points.push({
      date: group.completedAt,
      sessionLogId,
      topSetWeight,
      topSetReps,
      estimatedOneRepMax:
        estimatedOneRepMax != null
          ? Math.round(estimatedOneRepMax * 10) / 10
          : null,
      totalVolume,
      topSetRpe,
      prescribedSets,
      actualSets: group.sets.length,
      prescribedRepsMin,
      prescribedRepsMax,
    });
  }

  // Sort by date ASC (RPC already returns ASC, but defensive against future RPC reordering)
  points.sort((a, b) => (a.date < b.date ? -1 : 1));
  return points;
}

export async function getExercisePRs(
  clientId: string,
  opts: { exerciseId?: string; exerciseName?: string }
): Promise<ExercisePR[]> {
  const { data, error } = await supabaseAdmin.rpc("get_exercise_prs", {
    p_client_id: clientId,
    p_exercise_id: opts.exerciseId,
    p_exercise_name: opts.exerciseName,
  });
  if (error) {
    throw new Error(`Failed to fetch exercise PRs: ${error.message}`);
  }

  const now = new Date();
  const twentyEightDaysAgo = new Date(
    now.getTime() - 28 * 24 * 60 * 60 * 1000
  );

  return (data ?? []).map((row) => ({
    reps: row.reps,
    weight: Number(row.weight),
    date: row.date,
    isRecent: new Date(row.date) >= twentyEightDaysAgo,
  }));
}
