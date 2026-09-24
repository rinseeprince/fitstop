import { supabaseAdmin } from "./supabase-admin";
import { getExercisePRs } from "./exercise-analytics-service";
import type { ActivityItem } from "@/types/coach-brief";
import type { ExercisePR } from "@/types/training";

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
const PR_NEW_SESSION_GUARD = 20;

/** A coach's reading, as the measurement log holds it: the day it belongs to
 *  (`recorded_on`) and when it was written (`recorded_at`, the feed anchor). */
export type MeasurementFeedRow = {
  metric_key: string;
  value: number;
  recorded_on: string;
  recorded_at: string;
};

/**
 * An exercise the new sessions logged, as its records are asked for: its
 * catalog exercise — the one done, else the one prescribed — else the name
 * typed (exercise_log_identity, migration 191), with the name the feed shows.
 */
type LoggedExercise = {
  exerciseId: string | null;
  exerciseName: string;
};

type NewExerciseRow = {
  session_log_id: string;
  exercise_id: string | null;
  performed_name: string | null;
  prescribed_exercise_snapshot: unknown;
  training_exercises: { exercise_id: string | null } | null;
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

/** Key for a resolved predecessor lookup: one entry per (metric, day). */
export function predecessorKey(metricKey: string, recordedOn: string): string {
  return `${metricKey}|${recordedOn}`;
}

/**
 * Measurement items, each with the value of the same metric on the latest
 * earlier day — of any source, by the log's day rule. Predecessors are
 * resolved per row by the caller (one bounded query each) and passed in keyed
 * by predecessorKey, so a long measurement history can never truncate the
 * lookup.
 */
export function buildMeasurementItems(
  newRows: MeasurementFeedRow[],
  predecessorValues: Map<string, number>
): ActivityItem[] {
  return newRows.map((row) => {
    const previous = predecessorValues.get(predecessorKey(row.metric_key, row.recorded_on));
    return {
      type: "measurement" as const,
      at: row.recorded_at,
      metricKey: row.metric_key,
      value: Number(row.value),
      previousValue: previous === undefined ? null : Number(previous),
    };
  });
}

/**
 * The exercises the new sessions logged, once each, keyed the way the records
 * are (exercise_log_identity, migration 191): the catalog id, direct or
 * through the prescribed row, else the performed name. A log with neither
 * belongs to no exercise the records can be asked for.
 */
export function exercisesLoggedIn(rows: readonly NewExerciseRow[]): LoggedExercise[] {
  const byIdentity = new Map<string, LoggedExercise>();
  for (const row of rows) {
    const exerciseId = row.exercise_id ?? row.training_exercises?.exercise_id ?? null;
    if (!exerciseId && !row.performed_name) continue;
    const key = exerciseId ? `id:${exerciseId}` : `name:${row.performed_name!.toLowerCase()}`;
    if (byIdentity.has(key)) continue;
    byIdentity.set(key, {
      exerciseId,
      exerciseName:
        row.performed_name ?? snapshotName(row.prescribed_exercise_snapshot) ?? "Unknown exercise",
    });
  }
  return [...byIdentity.values()];
}

type RepMax = Extract<ExercisePR, { kind: "rep_max" }>;

/** The heaviest weight of the rep maxes — the heaviest load lifted, whatever the reps. */
function heaviestLift(records: readonly ExercisePR[]): RepMax | null {
  let top: RepMax | null = null;
  for (const record of records) {
    if (record.kind === "rep_max" && (top === null || record.weight > top.weight)) top = record;
  }
  return top;
}

/**
 * The PR items one exercise's new sessions earn: each record a new session now
 * holds that beats the exercise's record of the same kind — at the same
 * distance, for a time or a carry — as it stood before them (get_exercise_prs
 * with the new sessions' days excluded). The records are the ones the PR cards
 * show, so the feed and the cards agree: an Endurance or Erg time is a race
 * distance's. A record with none before it is a first, not a PR — a first-ever
 * exercise emits nothing — and of the rep maxes only the heaviest weight is
 * announced (locked decision 5). `at` is the feed anchor of the session that
 * set it.
 */
export function prItemsFor(
  exerciseName: string,
  records: readonly ExercisePR[],
  priorRecords: readonly ExercisePR[],
  sessionAt: ReadonlyMap<string, string>
): ActivityItem[] {
  const heldNow = (record: ExercisePR) => {
    const at = sessionAt.get(record.sessionLogId);
    return at === undefined ? null : { type: "pr" as const, at, exerciseName };
  };
  const items: ActivityItem[] = [];

  const load = heaviestLift(records);
  const priorLoad = heaviestLift(priorRecords);
  const loadBase = load ? heldNow(load) : null;
  if (load && loadBase && priorLoad && load.weight > priorLoad.weight) {
    items.push({ ...loadBase, kind: "load", weight: load.weight, previousBest: priorLoad.weight });
  }

  for (const record of records) {
    const base = heldNow(record);
    if (!base) continue;
    switch (record.kind) {
      case "rep_max":
        // The heaviest load is judged once, above
        break;
      case "best_reps": {
        const prior = priorRecords.find((p) => p.kind === "best_reps");
        if (prior?.kind === "best_reps" && record.reps > prior.reps) {
          items.push({ ...base, kind: "reps", reps: record.reps, previousBest: prior.reps });
        }
        break;
      }
      case "best_time": {
        const prior = priorRecords.find(
          (p) => p.kind === "best_time" && p.distanceMeters === record.distanceMeters
        );
        if (prior?.kind === "best_time" && record.durationSeconds < prior.durationSeconds) {
          items.push({
            ...base,
            kind: "time",
            distanceMeters: record.distanceMeters,
            race: record.race,
            durationSeconds: record.durationSeconds,
            previousBest: prior.durationSeconds,
          });
        }
        break;
      }
      case "heaviest_carry": {
        const prior = priorRecords.find(
          (p) => p.kind === "heaviest_carry" && p.distanceMeters === record.distanceMeters
        );
        if (prior?.kind === "heaviest_carry" && record.weight > prior.weight) {
          items.push({
            ...base,
            kind: "carry",
            distanceMeters: record.distanceMeters,
            weight: record.weight,
            previousBest: prior.weight,
          });
        }
        break;
      }
      case "longest_hold": {
        const prior = priorRecords.find((p) => p.kind === "longest_hold");
        if (prior?.kind === "longest_hold" && record.durationSeconds > prior.durationSeconds) {
          items.push({
            ...base,
            kind: "hold",
            durationSeconds: record.durationSeconds,
            previousBest: prior.durationSeconds,
          });
        }
        break;
      }
    }
  }
  return items;
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

/**
 * Coach-logged measurements since the coach's last visit: the measurement
 * log's `coach_entry` rows, keyed on `recorded_at` — when the row was written.
 * Degrades to empty on a failed read.
 */
async function fetchMeasurementItems(
  clientId: string,
  since: string
): Promise<ActivityItem[]> {
  const { data: newRows, error } = await supabaseAdmin
    .from("client_measurements_live")
    .select("metric_key, value, recorded_on, recorded_at")
    .eq("client_id", clientId)
    .eq("source", "coach_entry")
    .gt("recorded_at", since)
    .order("recorded_at", { ascending: false })
    .limit(ACTIVITY_FEED_CAP);

  if (error) {
    console.error("Failed to read new measurements for the activity feed:", error);
    return [];
  }
  const rows: MeasurementFeedRow[] = (newRows ?? []).flatMap((row) =>
    row.metric_key != null && row.value != null && row.recorded_on != null && row.recorded_at != null
      ? [{ metric_key: row.metric_key, value: Number(row.value), recorded_on: row.recorded_on, recorded_at: row.recorded_at }]
      : []
  );
  if (rows.length === 0) return [];

  // One bounded predecessor read per new row (≤20, one row each) rather than
  // pulling the client's whole measurement history, which would silently
  // truncate at PostgREST's row cap and yield an arbitrary "previous" value.
  // The predecessor is the latest EARLIER day's value by rule 2, of any source.
  const predecessorValues = new Map<string, number>();
  await Promise.all(
    rows.map(async (row) => {
      const { data, error: prevError } = await supabaseAdmin
        .from("client_measurements_live")
        .select("value")
        .eq("client_id", clientId)
        .eq("metric_key", row.metric_key)
        .lt("recorded_on", row.recorded_on)
        .order("recorded_on", { ascending: false })
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (prevError) {
        console.error("Failed to read the previous measurement:", prevError);
        return;
      }
      if (data?.value != null) {
        predecessorValues.set(predecessorKey(row.metric_key, row.recorded_on), Number(data.value));
      }
    })
  );

  return buildMeasurementItems(rows, predecessorValues);
}

async function fetchSessionActivity(
  clientId: string,
  since: string
): Promise<{
  items: ActivityItem[];
  exercises: LoggedExercise[];
  sessionAt: Map<string, string>;
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
    return { items: [], exercises: [], sessionAt: new Map(), attributionDates: new Set(), prSkipped: true };
  }
  const sessions = logs ?? [];
  if (!sessions.length) {
    return { items: [], exercises: [], sessionAt: new Map(), attributionDates: new Set(), prSkipped: false };
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
        "session_log_id, exercise_id, performed_name, prescribed_exercise_snapshot, training_exercises(exercise_id)"
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

  const exercises = prSkipped ? [] : exercisesLoggedIn(exerciseRows);

  // Each new session's feed anchor, by id: a record names the session that set it
  const sessionAt = new Map(sessions.map((s) => [s.id, s.created_at]));

  // The prescribed days these logs are attributed to — the PR detector excludes
  // them so a new session cannot become its own "previous best".
  const attributionDates = new Set(
    sessions.map((s) => s.completed_at.slice(0, 10))
  );

  return { items, exercises, sessionAt, attributionDates, prSkipped };
}

/**
 * PRs: a new log emits one for each record of its exercise it now holds and
 * that beats the record as it stood before — the heaviest load ever (locked
 * decision 5), the most reps in a bodyweight set, the fastest time at a
 * distance (a race distance for an Endurance or Erg exercise), the heaviest
 * carry at a distance, the longest hold — judged by prItemsFor on the records
 * the PR cards show (get_exercise_prs: the identity, the warm-up exclusion,
 * the race buckets). An exercise's records now come first; only one whose
 * record a new session holds is read a second time, with the new sessions'
 * own attribution dates excluded in SQL, for the record it beat. Excluding by
 * attribution DATE rather than against the anchor timestamp is load-bearing:
 * `session_logs.completed_at` is the prescribed day, written as a bare date at
 * midnight, while the anchor is a real clock time, and comparing the two
 * suppressed every PR logged later on a day whose midnight preceded the anchor
 * — the everyday "mark seen in the morning, client trains that evening" case.
 * Residual edge: a PRE-existing session attributed to the same calendar date
 * as a new one (a day holding several sessions, the first logged before the
 * coach last looked) is excluded too, so a previous best can be understated on
 * that date.
 */
export async function detectPrItems(
  clientId: string,
  exercises: readonly LoggedExercise[],
  sessionAt: ReadonlyMap<string, string>,
  attributionDates: ReadonlySet<string>
): Promise<ActivityItem[]> {
  if (!exercises.length) return [];
  const excludeDates = [...attributionDates];

  const results = await Promise.all(
    exercises.map(async (exercise): Promise<ActivityItem[]> => {
      const identity = exercise.exerciseId
        ? { exerciseId: exercise.exerciseId }
        : { exerciseName: exercise.exerciseName };
      try {
        const records = await getExercisePRs(clientId, identity);
        if (!records.some((record) => sessionAt.has(record.sessionLogId))) return [];
        const priorRecords = await getExercisePRs(clientId, { ...identity, excludeDates });
        return prItemsFor(exercise.exerciseName, records, priorRecords, sessionAt);
      } catch (error) {
        console.error(`Failed to compute PRs for ${exercise.exerciseName}:`, error);
        return [];
      }
    })
  );
  return results.flat();
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
    sessionActivity.exercises,
    sessionActivity.sessionAt,
    sessionActivity.attributionDates
  );

  return mergeAndCapActivity([
    ...checkInItems,
    ...measurementItems,
    ...sessionActivity.items,
    ...prItems,
  ]);
};
