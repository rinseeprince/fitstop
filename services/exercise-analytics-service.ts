import { supabaseAdmin } from "./supabase-admin";
import { fetchAllByChunkedIds } from "@/lib/paged-fetch";
import { countWorkingSets } from "@/utils/exercise-set-specs";
import { toExerciseType } from "@/utils/exercise-types";
import { isBestKind } from "@/utils/exercise-progress-markers";
import { LOGGED_MEASURES, SET_LOG_MEASURES } from "@/utils/set-log-measures";
import {
  aggregateSessionMarkers,
  type MarkerSet,
} from "@/utils/exercise-session-markers";
import type { Database } from "@/types/database";
import type {
  ExerciseBest,
  ExerciseListItem,
  ExerciseProgressionPoint,
  ExercisePR,
} from "@/types/training";

// ---------------------------------------------------------------------------
// Public API — backed by SQL RPCs (migrations 094 to 188). Identity-union,
// windowing and the bests live in Postgres; a session's values — its chart
// markers, its working sets and the figures of its Sessions table row — are
// computed in JS over the bounded RPC result by the one kernel
// (utils/exercise-session-markers.ts), so every exercise type reads one shape.
// ---------------------------------------------------------------------------

type ProgressionRow =
  Database["public"]["Functions"]["get_exercise_progression_window"]["Returns"][number];

/** A PR is "recent" for this long after the day it was set. */
const PR_RECENT_DAYS = 28;

const toNumber = (value: number | string | null | undefined): number | null =>
  value == null ? null : Number(value);

/**
 * One progression row's set as the kernel reads it: every numeric measure the
 * read returns, by the one table of them (migration 188's columns are
 * SET_LOG_MEASURES' — utils/exercise-progress-markers.test.ts reads the
 * migration against it), so a measure the table gains reaches the kernel here
 * with no second list. A NUMERIC may arrive as a string.
 */
function markerSetFromRow(row: ProgressionRow): MarkerSet {
  const measures: Record<string, number | null> = {};
  for (const measure of LOGGED_MEASURES) {
    const { key, column } = SET_LOG_MEASURES[measure];
    measures[key] = toNumber(row[column]);
  }
  return {
    // NOT NULL column (default 'working'); guarded for any legacy/null row.
    setType: row.set_type ?? "working",
    ...(measures as Omit<MarkerSet, "setType">),
  };
}

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
    // The catalog row's type; a freehand name has no row and reads as Strength
    exerciseType: toExerciseType(row.exercise_type),
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

  type SessionGroup = {
    completedAt: string;
    snapshot: Record<string, unknown> | null;
    sets: MarkerSet[];
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
    // A zero-set exercise_log still emits one row (LEFT JOIN): no set to add
    if (row.set_id !== null && row.set_id !== undefined) {
      group.sets.push(markerSetFromRow(row));
    }
  }

  // The calendar workout each session was logged for, so its row can open it
  const eventIds = await sessionLogEventIds([...groups.keys()]);

  const points: ExerciseProgressionPoint[] = [];

  for (const [sessionLogId, group] of groups) {
    const snapshot = group.snapshot;
    const snapshotSets =
      snapshot && typeof snapshot.sets === "number" ? snapshot.sets : null;
    const snapshotSpecs = snapshot ? snapshot.set_specs : null;
    // Prescribed working-set count: from set_specs (non-warmup) when the
    // prescription carries it, else the legacy compact `sets` count. Stays null
    // when neither exists (unknown prescription — excluded from compliance).
    const prescribedSets =
      snapshotSets == null && !Array.isArray(snapshotSpecs)
        ? null
        : countWorkingSets(snapshotSpecs, snapshotSets ?? 0);
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
      eventId: eventIds.get(sessionLogId) ?? null,
      ...aggregateSessionMarkers(group.sets),
      prescribedSets,
      prescribedRepsMin,
      prescribedRepsMax,
    });
  }

  // Sort by date ASC (RPC already returns ASC, but defensive against future RPC reordering)
  points.sort((a, b) => (a.date < b.date ? -1 : 1));
  return points;
}

/** Each session log's calendar workout (`session_logs.training_event_id`), by log id. */
async function sessionLogEventIds(sessionLogIds: string[]): Promise<Map<string, string | null>> {
  const rows = await fetchAllByChunkedIds(
    sessionLogIds,
    (chunk, from, to) =>
      supabaseAdmin
        .from("session_logs")
        .select("id, training_event_id")
        .in("id", chunk)
        .order("id")
        .range(from, to),
    { errorLabel: "the sessions' workouts" },
  );
  return new Map(rows.map((row) => [row.id, row.training_event_id]));
}

type ExercisePrOptions = {
  exerciseId?: string;
  exerciseName?: string;
  /**
   * Days (YYYY-MM-DD, the attribution day of a session log) whose sets are left
   * out, so the bests come back as they stood before those sessions — what the
   * Overview's PR feed compares a new session against.
   */
  excludeDates?: readonly string[];
};

/** A bests row read as its kind, or null for a row the kernel can't read (never written by the RPC). */
function bestFromRow(row: {
  kind: string | null;
  reps: number | null;
  weight: number | string | null;
  distance_meters: number | string | null;
  duration_seconds: number | string | null;
}): ExerciseBest | null {
  if (!isBestKind(row.kind)) return null;
  const weight = toNumber(row.weight);
  const distance = toNumber(row.distance_meters);
  const duration = toNumber(row.duration_seconds);
  switch (row.kind) {
    case "rep_max":
      return row.reps != null && weight != null
        ? { kind: "rep_max", reps: row.reps, weight }
        : null;
    case "best_reps":
      return row.reps != null ? { kind: "best_reps", reps: row.reps } : null;
    case "best_time":
      return distance != null && duration != null
        ? { kind: "best_time", distanceMeters: distance, durationSeconds: duration }
        : null;
    case "heaviest_carry":
      return distance != null && weight != null
        ? { kind: "heaviest_carry", distanceMeters: distance, weight }
        : null;
    case "longest_hold":
      return duration != null ? { kind: "longest_hold", durationSeconds: duration } : null;
  }
}

/**
 * An exercise's bests, all-time, every kind the logs carry (the view orders
 * them by the exercise's type — utils/exercise-progress-markers.ts).
 */
export async function getExercisePRs(
  clientId: string,
  opts: ExercisePrOptions
): Promise<ExercisePR[]> {
  const { data, error } = await supabaseAdmin.rpc("get_exercise_prs", {
    p_client_id: clientId,
    p_exercise_id: opts.exerciseId,
    p_exercise_name: opts.exerciseName,
    // Omitted (undefined) unless the caller excludes days: DEFAULT NULL in SQL
    p_exclude_dates: opts.excludeDates?.length ? [...opts.excludeDates] : undefined,
  });
  if (error) {
    throw new Error(`Failed to fetch exercise PRs: ${error.message}`);
  }

  const recentSince = Date.now() - PR_RECENT_DAYS * 24 * 60 * 60 * 1000;

  const records: ExercisePR[] = [];
  for (const row of data ?? []) {
    const best = bestFromRow(row);
    if (!best) continue;
    records.push({
      ...best,
      date: row.date,
      isRecent: new Date(row.date).getTime() >= recentSince,
    });
  }
  return records;
}
