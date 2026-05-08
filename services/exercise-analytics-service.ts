import { supabaseAdmin } from "./supabase-admin";
import {
  calculateEpleyE1RM,
  resolveExerciseIdentityKey,
  exerciseLogMatchesTarget,
} from "@/utils/exercise-analytics-helpers";
import type {
  ExerciseListItem,
  ExerciseProgressionPoint,
  ExercisePR,
} from "@/types/training";

// Internal shape returned by the shared fetch helper.
type ExerciseLogWithContext = {
  id: string;
  exerciseId: string | null;
  trainingExerciseId: string | null;
  performedName: string | null;
  sessionLogId: string;
  completedAt: string;
  prescribedExerciseSnapshot: Record<string, unknown> | null;
  // Resolved from the training_exercises table via trainingExerciseId
  trainingExerciseExerciseId: string | null;
};

// ---------------------------------------------------------------------------
// Shared fetch: loads all exercise logs for a client with both identity paths
// resolved. Uses three queries + in-memory join (same pattern as attachSetLogs
// in training-log-service.ts).
// ---------------------------------------------------------------------------

async function fetchExerciseLogsForClient(
  clientId: string
): Promise<ExerciseLogWithContext[]> {
  // 1. Fetch session_logs for this client
  const { data: sessionRows, error: sessionError } = await supabaseAdmin
    .from("session_logs")
    .select("id, completed_at")
    .eq("client_id", clientId);

  if (sessionError) {
    throw new Error(
      `Failed to fetch session logs: ${sessionError.message}`
    );
  }
  if (!sessionRows || sessionRows.length === 0) return [];

  const sessionMap = new Map<string, string>();
  for (const row of sessionRows) {
    sessionMap.set(row.id, row.completed_at);
  }

  // 2. Fetch exercise_logs for those sessions
  const { data: exerciseRows, error: exerciseError } = await supabaseAdmin
    .from("exercise_logs")
    .select(
      "id, exercise_id, training_exercise_id, performed_name, session_log_id, prescribed_exercise_snapshot"
    )
    .in(
      "session_log_id",
      sessionRows.map((r) => r.id)
    );

  if (exerciseError) {
    throw new Error(
      `Failed to fetch exercise logs: ${exerciseError.message}`
    );
  }
  if (!exerciseRows || exerciseRows.length === 0) return [];

  // 3. Fetch training_exercises for referenced training_exercise_ids
  const teIds = [
    ...new Set(
      exerciseRows
        .map((r) => r.training_exercise_id)
        .filter((id): id is string => id != null)
    ),
  ];

  const teMap = new Map<string, string | null>();
  if (teIds.length > 0) {
    const { data: teRows, error: teError } = await supabaseAdmin
      .from("training_exercises")
      .select("id, exercise_id")
      .in("id", teIds);

    if (teError) {
      throw new Error(
        `Failed to fetch training exercises: ${teError.message}`
      );
    }
    for (const row of teRows ?? []) {
      teMap.set(row.id, row.exercise_id);
    }
  }

  // Join in memory
  return exerciseRows.map((row) => ({
    id: row.id,
    exerciseId: row.exercise_id,
    trainingExerciseId: row.training_exercise_id,
    performedName: row.performed_name,
    sessionLogId: row.session_log_id,
    completedAt: sessionMap.get(row.session_log_id) ?? "",
    prescribedExerciseSnapshot: row.prescribed_exercise_snapshot as Record<
      string,
      unknown
    > | null,
    trainingExerciseExerciseId: row.training_exercise_id
      ? (teMap.get(row.training_exercise_id) ?? null)
      : null,
  }));
}

// ---------------------------------------------------------------------------
// Fetches set_logs for the given exercise_log IDs and groups by exercise_log_id.
// ---------------------------------------------------------------------------

type RawSetLog = {
  id: string;
  exercise_log_id: string;
  set_number: number;
  reps: number | null;
  weight: number | null;
  rpe: number | null;
  created_at: string;
};

async function fetchSetLogsForExerciseLogs(
  exerciseLogIds: string[]
): Promise<Map<string, RawSetLog[]>> {
  const result = new Map<string, RawSetLog[]>();
  if (exerciseLogIds.length === 0) return result;

  const { data, error } = await supabaseAdmin
    .from("set_logs")
    .select("id, exercise_log_id, set_number, reps, weight, rpe, created_at")
    .in("exercise_log_id", exerciseLogIds)
    .order("set_number", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch set logs: ${error.message}`);
  }
  for (const row of data ?? []) {
    const list = result.get(row.exercise_log_id) ?? [];
    list.push(row);
    result.set(row.exercise_log_id, list);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns all exercises a client has logged, ordered by frequency.
 * Groups by resolved exercise identity (exercise_id or name fallback).
 */
export async function getClientExerciseList(
  clientId: string
): Promise<ExerciseListItem[]> {
  const logs = await fetchExerciseLogsForClient(clientId);
  if (logs.length === 0) return [];

  // Group by identity key
  const groups = new Map<
    string,
    { exerciseId: string | null; logs: ExerciseLogWithContext[] }
  >();

  for (const log of logs) {
    const key = resolveExerciseIdentityKey(
      log.exerciseId,
      log.trainingExerciseExerciseId,
      log.performedName
    );
    const group = groups.get(key) ?? {
      exerciseId: log.exerciseId ?? log.trainingExerciseExerciseId ?? null,
      logs: [],
    };
    group.logs.push(log);
    groups.set(key, group);
  }

  // Aggregate per group
  const items: ExerciseListItem[] = [];
  for (const [, group] of groups) {
    // Name from the most recent log (by completedAt)
    const sorted = group.logs.sort(
      (a, b) => (a.completedAt < b.completedAt ? 1 : -1)
    );
    const name =
      sorted[0].performedName ?? "Unknown exercise";

    items.push({
      exerciseId: group.exerciseId,
      name,
      logCount: group.logs.length,
      lastLoggedDate: sorted[0].completedAt,
    });
  }

  // Order by frequency DESC
  items.sort((a, b) => b.logCount - a.logCount);
  return items;
}

/**
 * Returns time-series progression data for a specific exercise.
 * Each point represents one session where the client logged this exercise.
 */
export async function getExerciseProgressionSeries(
  clientId: string,
  opts: { exerciseId?: string; exerciseName?: string; sessionCount?: number }
): Promise<ExerciseProgressionPoint[]> {
  const logs = await fetchExerciseLogsForClient(clientId);
  const matching = logs.filter((log) => exerciseLogMatchesTarget(log, opts));
  if (matching.length === 0) return [];

  const setLogMap = await fetchSetLogsForExerciseLogs(
    matching.map((l) => l.id)
  );

  // Group by sessionLogId (client might log same exercise twice in one session)
  const sessionGroups = new Map<
    string,
    { completedAt: string; exerciseLogs: ExerciseLogWithContext[]; allSets: RawSetLog[] }
  >();

  for (const log of matching) {
    const group = sessionGroups.get(log.sessionLogId) ?? {
      completedAt: log.completedAt,
      exerciseLogs: [],
      allSets: [],
    };
    group.exerciseLogs.push(log);
    const sets = setLogMap.get(log.id) ?? [];
    group.allSets.push(...sets);
    sessionGroups.set(log.sessionLogId, group);
  }

  // Build progression points
  const points: ExerciseProgressionPoint[] = [];

  for (const [sessionLogId, group] of sessionGroups) {
    const sets = group.allSets;

    // Top set: highest weight, tiebreak by highest reps
    let topSetWeight: number | null = null;
    let topSetReps: number | null = null;
    let topSetRpe: number | null = null;

    for (const s of sets) {
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
    for (const s of sets) {
      if (s.reps != null && s.weight != null) {
        totalVolume = (totalVolume ?? 0) + s.reps * s.weight;
      }
    }

    // Best estimated 1RM across all sets (not just the heaviest)
    let estimatedOneRepMax: number | null = null;
    for (const s of sets) {
      if (s.reps != null && s.weight != null) {
        const e1rm = calculateEpleyE1RM(s.weight, s.reps);
        if (e1rm != null && (estimatedOneRepMax == null || e1rm > estimatedOneRepMax)) {
          estimatedOneRepMax = e1rm;
        }
      }
    }

    // Prescribed data from the first exercise log's snapshot
    const snapshot = group.exerciseLogs[0]?.prescribedExerciseSnapshot;
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
      actualSets: sets.length,
      prescribedRepsMin,
      prescribedRepsMax,
    });
  }

  // Sort by date ASC
  points.sort((a, b) => (a.date < b.date ? -1 : 1));

  // Limit to most recent N sessions
  const limit = opts.sessionCount ?? 12;
  return points.slice(-limit);
}

/**
 * Returns the best weight per distinct rep count (personal records)
 * for a specific exercise.
 */
export async function getExercisePRs(
  clientId: string,
  opts: { exerciseId?: string; exerciseName?: string }
): Promise<ExercisePR[]> {
  const logs = await fetchExerciseLogsForClient(clientId);
  const matching = logs.filter((log) => exerciseLogMatchesTarget(log, opts));
  if (matching.length === 0) return [];

  const setLogMap = await fetchSetLogsForExerciseLogs(
    matching.map((l) => l.id)
  );

  // Build a completedAt lookup for each exercise_log
  const logDateMap = new Map<string, string>();
  for (const log of matching) {
    logDateMap.set(log.id, log.completedAt);
  }

  // Track best weight per rep count
  const prMap = new Map<number, { weight: number; date: string }>();

  for (const [exerciseLogId, sets] of setLogMap) {
    const date = logDateMap.get(exerciseLogId) ?? "";
    for (const s of sets) {
      if (s.reps == null || s.weight == null || s.weight <= 0) continue;
      const existing = prMap.get(s.reps);
      if (!existing || s.weight > existing.weight) {
        prMap.set(s.reps, { weight: s.weight, date });
      }
    }
  }

  // Convert to array with isRecent flag
  const now = new Date();
  const twentyEightDaysAgo = new Date(
    now.getTime() - 28 * 24 * 60 * 60 * 1000
  );

  const prs: ExercisePR[] = [];
  for (const [reps, record] of prMap) {
    prs.push({
      reps,
      weight: record.weight,
      date: record.date,
      isRecent: new Date(record.date) >= twentyEightDaysAgo,
    });
  }

  // Sort by reps ascending
  prs.sort((a, b) => a.reps - b.reps);
  return prs;
}
