import { supabaseAdmin } from "./supabase-admin";
import { getExercisePRs } from "./exercise-analytics-service";
import {
  hasLoad,
  isBodyweightSet,
  isHold,
  isLift,
  isTimedDistance,
  type SetShape,
} from "@/utils/exercise-session-markers";
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

export type MetricEntryFeedRow = {
  metric_key: string;
  value: number;
  entry_date: string;
  created_at: string;
};

/**
 * What a new session might have beaten, one candidate per kind — and per
 * distance for a time or a carry — read off the logged columns the way the
 * chart markers and get_exercise_prs are (utils/exercise-session-markers.ts):
 * a load is a weight above zero — a lift's when logged with neither a distance
 * nor a time, a carry's over a distance — reps with no load, and neither a
 * distance nor a time, are a bodyweight set, a time with a distance a timed
 * distance, a time with no distance a hold. Reps on a distance or a time are
 * repeats, so they announce no reps and no lift. `at` is the feed anchor of the
 * session that set it.
 */
export type PrCandidate =
  | { kind: "load"; weight: number; at: string }
  | { kind: "reps"; reps: number; at: string }
  | { kind: "time"; distanceMeters: number; durationSeconds: number; at: string }
  | { kind: "carry"; distanceMeters: number; weight: number; at: string }
  | { kind: "hold"; durationSeconds: number; at: string };

type NewExerciseBests = {
  exerciseId: string | null;
  exerciseName: string;
  candidates: PrCandidate[];
};

type NewExerciseRow = {
  session_log_id: string;
  exercise_id: string | null;
  performed_name: string | null;
  prescribed_exercise_snapshot: unknown;
  training_exercises: { exercise_id: string | null } | null;
  set_logs: {
    weight: number | null;
    reps: number | null;
    distance_meters: number | null;
    duration_seconds: number | null;
    set_type: string;
  }[];
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

/** A candidate's key inside one exercise: its kind, and its distance where one applies. */
function candidateKey(candidate: PrCandidate): string {
  return candidate.kind === "time" || candidate.kind === "carry"
    ? `${candidate.kind}:${candidate.distanceMeters}`
    : candidate.kind;
}

/** Whether `next` beats `current` — strictly, so the first session to reach a value keeps it. */
function beats(next: PrCandidate, current: PrCandidate): boolean {
  switch (next.kind) {
    case "load":
      return current.kind === "load" && next.weight > current.weight;
    case "reps":
      return current.kind === "reps" && next.reps > current.reps;
    case "time":
      return current.kind === "time" && next.durationSeconds < current.durationSeconds;
    case "carry":
      return current.kind === "carry" && next.weight > current.weight;
    case "hold":
      return current.kind === "hold" && next.durationSeconds > current.durationSeconds;
  }
}

/**
 * The best new non-warmup value per exercise and kind across the new sessions.
 * Identity mirrors the get_exercise_prs union: catalog id (direct or via the
 * prescribed training_exercise) first, else performed name.
 */
export function collectNewExerciseBests(
  exercises: NewExerciseRow[],
  sessionCreatedAtById: Map<string, string>
): NewExerciseBests[] {
  const byExercise = new Map<
    string,
    { exerciseId: string | null; exerciseName: string; byKey: Map<string, PrCandidate> }
  >();
  for (const row of exercises) {
    const exerciseId = row.exercise_id ?? row.training_exercises?.exercise_id ?? null;
    const exerciseName =
      row.performed_name ?? snapshotName(row.prescribed_exercise_snapshot) ?? null;
    if (!exerciseId && !exerciseName) continue;
    const key = exerciseId ? `id:${exerciseId}` : `name:${exerciseName!.toLowerCase()}`;
    const at = sessionCreatedAtById.get(row.session_log_id);
    if (!at) continue;

    let entry = byExercise.get(key);
    if (!entry) {
      entry = { exerciseId, exerciseName: exerciseName ?? "Unknown exercise", byKey: new Map() };
      byExercise.set(key, entry);
    }
    const offer = (candidate: PrCandidate) => {
      const k = candidateKey(candidate);
      const current = entry.byKey.get(k);
      if (!current || beats(candidate, current)) entry.byKey.set(k, candidate);
    };

    for (const logged of row.set_logs) {
      if (logged.set_type === "warmup") continue;
      const set: SetShape = {
        reps: logged.reps,
        weight: logged.weight,
        distanceMeters: logged.distance_meters,
        durationSeconds: logged.duration_seconds,
      };
      // A load lifted is a lift's; over a distance it is a carry's; held for a
      // time it is a hold's, which its time below answers for
      if (isLift(set)) offer({ kind: "load", weight: set.weight as number, at });
      if (hasLoad(set) && set.distanceMeters != null) {
        offer({ kind: "carry", distanceMeters: set.distanceMeters, weight: set.weight as number, at });
      }
      if (isBodyweightSet(set)) offer({ kind: "reps", reps: set.reps as number, at });
      if (isTimedDistance(set)) {
        offer({
          kind: "time",
          distanceMeters: set.distanceMeters as number,
          durationSeconds: set.durationSeconds as number,
          at,
        });
      }
      if (isHold(set)) offer({ kind: "hold", durationSeconds: set.durationSeconds as number, at });
    }
  }
  return [...byExercise.values()]
    .filter((entry) => entry.byKey.size > 0)
    .map(({ exerciseId, exerciseName, byKey }) => ({
      exerciseId,
      exerciseName,
      candidates: [...byKey.values()],
    }));
}

/**
 * The PR items one exercise's new sessions earn, judged against its bests as
 * they stood before them (get_exercise_prs with the new sessions' days
 * excluded). A value with no prior best of its kind — or none at its distance —
 * is a first, not a PR: a first-ever exercise emits nothing.
 */
export function prItemsFor(
  exerciseName: string,
  candidates: readonly PrCandidate[],
  priorBests: readonly ExercisePR[]
): ActivityItem[] {
  let priorLoad: number | null = null;
  let priorReps: number | null = null;
  let priorHold: number | null = null;
  const priorTime = new Map<number, number>();
  const priorCarry = new Map<number, number>();
  for (const best of priorBests) {
    switch (best.kind) {
      case "rep_max":
        if (priorLoad === null || best.weight > priorLoad) priorLoad = best.weight;
        break;
      case "best_reps":
        priorReps = best.reps;
        break;
      case "best_time":
        priorTime.set(best.distanceMeters, best.durationSeconds);
        break;
      case "heaviest_carry":
        priorCarry.set(best.distanceMeters, best.weight);
        break;
      case "longest_hold":
        priorHold = best.durationSeconds;
        break;
    }
  }

  const items: ActivityItem[] = [];
  for (const candidate of candidates) {
    const base = { type: "pr" as const, at: candidate.at, exerciseName };
    switch (candidate.kind) {
      case "load":
        if (priorLoad !== null && candidate.weight > priorLoad) {
          items.push({ ...base, kind: "load", weight: candidate.weight, previousBest: priorLoad });
        }
        break;
      case "reps":
        if (priorReps !== null && candidate.reps > priorReps) {
          items.push({ ...base, kind: "reps", reps: candidate.reps, previousBest: priorReps });
        }
        break;
      case "time": {
        const prior = priorTime.get(candidate.distanceMeters);
        if (prior !== undefined && candidate.durationSeconds < prior) {
          items.push({
            ...base,
            kind: "time",
            distanceMeters: candidate.distanceMeters,
            durationSeconds: candidate.durationSeconds,
            previousBest: prior,
          });
        }
        break;
      }
      case "carry": {
        const prior = priorCarry.get(candidate.distanceMeters);
        if (prior !== undefined && candidate.weight > prior) {
          items.push({
            ...base,
            kind: "carry",
            distanceMeters: candidate.distanceMeters,
            weight: candidate.weight,
            previousBest: prior,
          });
        }
        break;
      }
      case "hold":
        if (priorHold !== null && candidate.durationSeconds > priorHold) {
          items.push({ ...base, kind: "hold", durationSeconds: candidate.durationSeconds, previousBest: priorHold });
        }
        break;
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
 * Coach-logged measurements since the coach's last visit: the seven physique
 * metrics from the measurement log (`source = 'coach_entry'`, keyed on
 * `recorded_at` — when the row was written) and the five wellness metrics
 * from client_metric_entries. Both halves degrade to empty on a failed read.
 */
async function fetchMeasurementItems(
  clientId: string,
  since: string
): Promise<ActivityItem[]> {
  const [physique, wellness] = await Promise.all([
    fetchLoggedMeasurementItems(clientId, since),
    fetchWellnessEntryItems(clientId, since),
  ]);
  return [...physique, ...wellness];
}

async function fetchLoggedMeasurementItems(
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
  const rows: MetricEntryFeedRow[] = (newRows ?? []).flatMap((row) =>
    row.metric_key != null && row.value != null && row.recorded_on != null && row.recorded_at != null
      ? [{ metric_key: row.metric_key, value: Number(row.value), entry_date: row.recorded_on, created_at: row.recorded_at }]
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
        .lt("recorded_on", row.entry_date)
        .order("recorded_on", { ascending: false })
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (prevError) {
        console.error("Failed to read the previous measurement:", prevError);
        return;
      }
      if (data?.value != null) {
        predecessorValues.set(predecessorKey(row.metric_key, row.entry_date), Number(data.value));
      }
    })
  );

  return buildMeasurementItems(rows, predecessorValues);
}

async function fetchWellnessEntryItems(
  clientId: string,
  since: string
): Promise<ActivityItem[]> {
  const { data: newRows, error } = await supabaseAdmin
    .from("client_metric_entries")
    .select("metric_key, value, entry_date, created_at")
    .eq("client_id", clientId)
    .in("metric_key", ["mood", "energy", "sleep", "stress", "soreness"])
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
  bests: NewExerciseBests[];
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
        "session_log_id, exercise_id, performed_name, prescribed_exercise_snapshot, training_exercises(exercise_id), set_logs(weight, reps, distance_meters, duration_seconds, set_type)"
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
 * PRs: a new log emits one for each best of its exercise it beat — the
 * heaviest load ever (locked decision 5), the most reps in
 * a bodyweight set, the fastest time at a distance, the heaviest carry at a
 * distance, the longest hold — judged by prItemsFor against get_exercise_prs
 * (the canonical identity union and warm-up exclusion) with the new sessions'
 * own attribution dates excluded in SQL. Excluding by attribution DATE rather
 * than against the anchor timestamp is load-bearing: `session_logs.completed_at`
 * is the prescribed day, written as a bare date at midnight, while the anchor
 * is a real clock time, and comparing the two suppressed every PR logged later
 * on a day whose midnight preceded the anchor — the everyday "mark seen in the
 * morning, client trains that evening" case. Residual edge: a PRE-existing
 * session attributed to the same calendar date as a new one (a day holding
 * several sessions, the first logged before the coach last looked) is excluded
 * too, so a previous best can be understated on that date.
 */
async function detectPrItems(
  clientId: string,
  bests: NewExerciseBests[],
  attributionDates: ReadonlySet<string>
): Promise<ActivityItem[]> {
  if (!bests.length) return [];
  const excludeDates = [...attributionDates];

  const results = await Promise.all(
    bests.map(async (best): Promise<ActivityItem[]> => {
      try {
        const rows = await getExercisePRs(clientId, {
          ...(best.exerciseId ? { exerciseId: best.exerciseId } : { exerciseName: best.exerciseName }),
          excludeDates,
        });
        return prItemsFor(best.exerciseName, best.candidates, rows);
      } catch (error) {
        console.error(`Failed to compute PRs for ${best.exerciseName}:`, error);
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
