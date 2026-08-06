import { supabaseAdmin } from "./supabase-admin";
import { getExercisePRs } from "./exercise-analytics-service";
import type { ActivityItem } from "@/types/coach-brief";

/**
 * Item-level "since your last visit" activity feed for the coach Overview
 * (check-ins, coach-logged measurements, PRs, completed sessions), all anchored
 * on coach_client_views.last_viewed_at. Shape B: the overview-brief route has
 * verified ownership; every query filters on the passed clientId.
 *
 * Each source degrades gracefully (logged empty result) so one failed read
 * never blanks the whole brief — same posture as the sinceLastVisit counts.
 */

export const ACTIVITY_FEED_CAP = 20;
// Past this many new sessions PR detection is skipped entirely (locked decision
// 5) — the per-exercise RPC fan-out isn't worth it on a backlog that large.
export const PR_NEW_SESSION_GUARD = 20;

export type MetricEntryFeedRow = {
  metric_key: string;
  value: number;
  entry_date: string;
  created_at: string;
};

export type NewExerciseBest = {
  exerciseId: string | null;
  exerciseName: string;
  newMax: number;
  at: string;
};

type NewExerciseRow = {
  session_log_id: string;
  exercise_id: string | null;
  performed_name: string | null;
  prescribed_exercise_snapshot: unknown;
  training_exercises: { exercise_id: string | null } | null;
  set_logs: { weight: number | null; set_type: string }[];
};

function snapshotName(snapshot: unknown): string | null {
  if (snapshot && typeof snapshot === "object" && "name" in snapshot) {
    const name = (snapshot as { name?: unknown }).name;
    if (typeof name === "string" && name) return name;
  }
  return null;
}

/** Newest-first by `at`, capped — the one ordering rule for the merged feed. */
export function mergeAndCapActivity(
  items: ActivityItem[],
  cap: number = ACTIVITY_FEED_CAP
): ActivityItem[] {
  return [...items]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, cap);
}

/** Key for a resolved predecessor lookup: one entry per (metric, date). */
export function predecessorKey(metricKey: string, entryDate: string): string {
  return `${metricKey}|${entryDate}`;
}

/**
 * Measurement items with the previous same-metric value (this table only —
 * check-in-derived values deliberately excluded, mig 132 note). Predecessors
 * are resolved per row by the caller (one bounded query each) and passed in
 * keyed by predecessorKey, so a long measurement history can never truncate
 * the lookup.
 */
export function buildMeasurementItems(
  newRows: MetricEntryFeedRow[],
  predecessorValues: Map<string, number>
): ActivityItem[] {
  return newRows.map((row) => {
    const previous = predecessorValues.get(predecessorKey(row.metric_key, row.entry_date));
    return {
      type: "measurement" as const,
      at: row.created_at,
      metricKey: row.metric_key,
      value: Number(row.value),
      previousValue: previous === undefined ? null : Number(previous),
    };
  });
}

/**
 * Best new non-warmup weight per exercise across the new sessions. Identity
 * mirrors the get_exercise_prs union: catalog id (direct or via the prescribed
 * training_exercise) first, else performed name.
 */
export function collectNewExerciseBests(
  exercises: NewExerciseRow[],
  sessionCreatedAtById: Map<string, string>
): NewExerciseBest[] {
  const bests = new Map<string, NewExerciseBest>();
  for (const row of exercises) {
    const exerciseId = row.exercise_id ?? row.training_exercises?.exercise_id ?? null;
    const exerciseName =
      row.performed_name ?? snapshotName(row.prescribed_exercise_snapshot) ?? null;
    if (!exerciseId && !exerciseName) continue;
    const key = exerciseId ? `id:${exerciseId}` : `name:${exerciseName!.toLowerCase()}`;
    const at = sessionCreatedAtById.get(row.session_log_id);
    if (!at) continue;

    let rowMax: number | null = null;
    for (const set of row.set_logs) {
      if (set.set_type === "warmup" || set.weight == null || set.weight <= 0) continue;
      if (rowMax === null || set.weight > rowMax) rowMax = set.weight;
    }
    if (rowMax === null) continue;

    const existing = bests.get(key);
    if (!existing || rowMax > existing.newMax) {
      bests.set(key, {
        exerciseId,
        exerciseName: exerciseName ?? "Unknown exercise",
        newMax: rowMax,
        at,
      });
    }
  }
  return [...bests.values()];
}

/**
 * Best weight among PR rows that are NOT attributable to the new sessions.
 *
 * Excluding by attribution DATE (not by comparing against the anchor
 * timestamp) is load-bearing: `session_logs.completed_at` is the prescribed
 * day, written as a bare date → midnight, while the anchor is a real clock
 * time. Comparing the two suppressed every PR logged later on a day whose
 * midnight preceded the anchor — i.e. the everyday "mark seen in the morning,
 * client trains that evening" case.
 *
 * Residual edge: if a PRE-existing session is attributed to the same calendar
 * date as one of the new sessions, its row is excluded too, so previousBest can
 * be understated on that date. The RPC keeps the earliest date per rep bucket,
 * so a weight first hit on an older date still survives.
 */
export function priorBestExcludingDates(
  rows: { weight: number; date: string }[],
  excludedDates: ReadonlySet<string>
): number | null {
  let best: number | null = null;
  for (const row of rows) {
    if (excludedDates.has(row.date.slice(0, 10))) continue;
    if (best === null || row.weight > best) best = row.weight;
  }
  return best;
}

async function fetchCheckInItems(clientId: string, since: string): Promise<ActivityItem[]> {
  const { data, error } = await supabaseAdmin
    .from("check_ins")
    .select("created_at")
    .eq("client_id", clientId)
    .gt("created_at", since)
    .order("created_at", { ascending: false })
    .limit(ACTIVITY_FEED_CAP);

  if (error) {
    console.error("Failed to read new check-ins for the activity feed:", error);
    return [];
  }
  return (data ?? [])
    .filter((row): row is { created_at: string } => !!row.created_at)
    .map((row) => ({ type: "check_in" as const, at: row.created_at }));
}

async function fetchMeasurementItems(
  clientId: string,
  since: string
): Promise<ActivityItem[]> {
  const { data: newRows, error } = await supabaseAdmin
    .from("client_metric_entries")
    .select("metric_key, value, entry_date, created_at")
    .eq("client_id", clientId)
    .gt("created_at", since)
    .order("created_at", { ascending: false })
    .limit(ACTIVITY_FEED_CAP);

  if (error) {
    console.error("Failed to read new metric entries for the activity feed:", error);
    return [];
  }
  if (!newRows?.length) return [];

  // One bounded predecessor read per new row (≤20, one row each) rather than
  // pulling the client's whole measurement history, which would silently
  // truncate at PostgREST's row cap and yield an arbitrary "previous" value.
  const predecessorValues = new Map<string, number>();
  await Promise.all(
    newRows.map(async (row) => {
      const { data, error: prevError } = await supabaseAdmin
        .from("client_metric_entries")
        .select("value")
        .eq("client_id", clientId)
        .eq("metric_key", row.metric_key)
        .lt("entry_date", row.entry_date)
        .order("entry_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (prevError) {
        console.error("Failed to read the previous metric entry:", prevError);
        return;
      }
      if (data) predecessorValues.set(predecessorKey(row.metric_key, row.entry_date), data.value);
    })
  );

  return buildMeasurementItems(newRows, predecessorValues);
}

async function fetchSessionActivity(
  clientId: string,
  since: string
): Promise<{
  items: ActivityItem[];
  bests: NewExerciseBest[];
  attributionDates: Set<string>;
  prSkipped: boolean;
}> {
  const { data: logs, error } = await supabaseAdmin
    .from("session_logs")
    .select("id, created_at, completed_at, training_session_id, prescribed_session_snapshot")
    .eq("client_id", clientId)
    .gt("created_at", since)
    // NULL completion_quality reads as "full" everywhere; a bare .neq would drop it
    .or("completion_quality.neq.skipped,completion_quality.is.null")
    .order("created_at", { ascending: false })
    .limit(PR_NEW_SESSION_GUARD + 1);

  if (error) {
    console.error("Failed to read new session logs for the activity feed:", error);
    return { items: [], bests: [], attributionDates: new Set(), prSkipped: true };
  }
  const sessions = logs ?? [];
  if (!sessions.length) {
    return { items: [], bests: [], attributionDates: new Set(), prSkipped: false };
  }

  const prSkipped = sessions.length > PR_NEW_SESSION_GUARD;
  const performedIds = [
    ...new Set(
      sessions
        .map((s) => s.training_session_id)
        .filter((id): id is string => !!id)
    ),
  ];

  const [namesResult, exercisesResult] = await Promise.all([
    performedIds.length
      ? supabaseAdmin.from("training_sessions").select("id, name").in("id", performedIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
    supabaseAdmin
      .from("exercise_logs")
      .select(
        "session_log_id, exercise_id, performed_name, prescribed_exercise_snapshot, training_exercises(exercise_id), set_logs(weight, set_type)"
      )
      .in("session_log_id", sessions.map((s) => s.id)),
  ]);

  if (namesResult.error) {
    console.error("Failed to read performed session names for the activity feed:", namesResult.error);
  }
  if (exercisesResult.error) {
    console.error("Failed to read exercise logs for the activity feed:", exercisesResult.error);
  }

  const namesById = new Map((namesResult.data ?? []).map((row) => [row.id, row.name]));
  const exerciseRows = (exercisesResult.data ?? []) as NewExerciseRow[];

  const exerciseCountBySession = new Map<string, number>();
  for (const row of exerciseRows) {
    exerciseCountBySession.set(
      row.session_log_id,
      (exerciseCountBySession.get(row.session_log_id) ?? 0) + 1
    );
  }

  const items: ActivityItem[] = sessions.map((log) => ({
    type: "session_completed" as const,
    at: log.created_at,
    sessionName:
      (log.training_session_id ? namesById.get(log.training_session_id) : undefined) ??
      snapshotName(log.prescribed_session_snapshot) ??
      "Workout",
    exerciseCount: exerciseCountBySession.get(log.id) ?? 0,
  }));

  const bests = prSkipped
    ? []
    : collectNewExerciseBests(
        exerciseRows,
        new Map(sessions.map((s) => [s.id, s.created_at]))
      );

  // The prescribed days these logs are attributed to — the PR detector excludes
  // them so a new session cannot become its own "previous best".
  const attributionDates = new Set(
    sessions.map((s) => s.completed_at.slice(0, 10))
  );

  return { items, bests, attributionDates, prSkipped };
}

/**
 * PRs per locked decision 5: heaviest non-warmup weight ever. A new log emits a
 * PR only when its top weight beats the prior all-time best; first-ever
 * exercises emit nothing. Prior best comes from the get_exercise_prs RPC (the
 * canonical identity union + warm-up exclusion) with the new sessions' own
 * attribution dates excluded — see priorBestExcludingDates for why the exclusion
 * is by date rather than against the anchor timestamp.
 */
async function detectPrItems(
  clientId: string,
  bests: NewExerciseBest[],
  attributionDates: ReadonlySet<string>
): Promise<ActivityItem[]> {
  if (!bests.length) return [];

  const results = await Promise.all(
    bests.map(async (best): Promise<ActivityItem | null> => {
      try {
        const rows = await getExercisePRs(
          clientId,
          best.exerciseId ? { exerciseId: best.exerciseId } : { exerciseName: best.exerciseName }
        );
        const previousBest = priorBestExcludingDates(rows, attributionDates);
        if (previousBest === null || best.newMax <= previousBest) return null;
        return {
          type: "pr",
          at: best.at,
          exerciseName: best.exerciseName,
          weight: best.newMax,
          previousBest,
        };
      } catch (error) {
        console.error(`Failed to compute PR for ${best.exerciseName}:`, error);
        return null;
      }
    })
  );
  return results.filter((item): item is ActivityItem => item !== null);
}

/** The merged since-last-visit feed. Caller passes a non-null anchor. */
export const getActivitySince = async (
  clientId: string,
  since: string
): Promise<ActivityItem[]> => {
  const [checkInItems, measurementItems, sessionActivity] = await Promise.all([
    fetchCheckInItems(clientId, since),
    fetchMeasurementItems(clientId, since),
    fetchSessionActivity(clientId, since),
  ]);

  const prItems = await detectPrItems(
    clientId,
    sessionActivity.bests,
    sessionActivity.attributionDates
  );

  return mergeAndCapActivity([
    ...checkInItems,
    ...measurementItems,
    ...sessionActivity.items,
    ...prItems,
  ]);
};
