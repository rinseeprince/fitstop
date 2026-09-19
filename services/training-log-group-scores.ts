import { supabaseAdmin } from "./supabase-admin";
import type {
  SessionLogGroupScoreInsert,
  SessionLogGroupScoreRow,
} from "@/lib/database-helpers";
import type { Json } from "@/types/database";
import type { GroupScore } from "@/types/training";
import type { GroupScoreInput } from "@/lib/validations/training";
import { groupSnapshotFormat, type GroupSnapshot } from "@/utils/exercise-groups";
import { groupScoreIssue, groupScoreValue } from "@/utils/group-scores";

// A timed group's score on a workout's log (migration 186): the rows under
// session_logs that record an AMRAP's rounds and reps or a For time's finish
// time. Read and written only from here; the log writer
// (services/training-log-service.ts) calls in, and the two detail reads embed
// the result beside the exercise logs.

/** A score row as it is stored, less the log it belongs to — resolved before the log row exists. */
type GroupScoreRowInput = Omit<SessionLogGroupScoreInsert, "session_log_id">;

function mapGroupScoreRow(row: SessionLogGroupScoreRow): GroupScore {
  const value = groupScoreValue({
    rounds: row.rounds,
    reps: row.reps,
    finishSeconds: row.finish_seconds,
  });
  // The table's shape CHECK forbids any other row, so one here means the
  // constraint and this reader have drifted apart.
  if (value === null) {
    throw new Error(`Group score ${row.id} is neither rounds and reps nor a finish time`);
  }
  return {
    id: row.id,
    sessionLogId: row.session_log_id,
    groupId: row.group_id,
    prescribedGroupSnapshot: row.prescribed_group_snapshot as Record<string, unknown>,
    ...value,
  };
}

/** Every score on a log, in the order they were written. */
export async function loadGroupScores(sessionLogId: string): Promise<GroupScore[]> {
  const { data, error } = await supabaseAdmin
    .from("session_log_group_scores")
    .select("*")
    .eq("session_log_id", sessionLogId)
    .order("created_at", { ascending: true });
  if (error) {
    throw new Error(`Failed to load group scores: ${error.message}`);
  }
  return (data ?? []).map(mapGroupScoreRow);
}

type ResolvedGroupScores =
  | { ok: true; rows: GroupScoreRowInput[] }
  /** A score names a group that is neither in the performed session nor already scored on this log. */
  | { ok: false; kind: "foreign" }
  /** A score the group's format cannot take. */
  | { ok: false; kind: "invalid"; message: string };

/**
 * The payload's scores as rows, each judged against the group it names.
 *
 * The group must be one the client is looking at: in the performed session's
 * prescription — a client-scoped read, so a foreign id is simply not there —
 * or, once that session is gone, already scored on this log, whose row keeps
 * the group's snapshot. Anything else is foreign, and the caller answers as it
 * does for a foreign exercise id. The group's format then decides the shape
 * (`utils/group-scores.ts`): a score the format cannot take is refused with
 * its sentence before anything is written.
 */
export function resolveGroupScores(args: {
  scores: readonly GroupScoreInput[];
  /** The performed session's live groups, by id. */
  liveGroups: ReadonlyMap<string, GroupSnapshot>;
  /** The log's existing scores, by group id — the snapshot fallback. */
  existing: ReadonlyMap<string, GroupScore>;
}): ResolvedGroupScores {
  const rows: GroupScoreRowInput[] = [];
  for (const score of args.scores) {
    const live = args.liveGroups.get(score.groupId);
    const snapshot: Record<string, unknown> | null =
      live ?? args.existing.get(score.groupId)?.prescribedGroupSnapshot ?? null;
    if (snapshot === null) return { ok: false, kind: "foreign" };
    const format = groupSnapshotFormat(snapshot);
    const issue = format === null ? null : groupScoreIssue(format, score);
    if (format === null || issue !== null) {
      return { ok: false, kind: "invalid", message: issue ?? "This group cannot be scored." };
    }
    const value = groupScoreValue(score);
    // The wire schema refused any other shape; the issue check above did too.
    if (value === null) return { ok: false, kind: "invalid", message: "This group cannot be scored." };
    rows.push({
      group_id: score.groupId,
      prescribed_group_snapshot: snapshot as unknown as Json,
      rounds: value.rounds,
      reps: value.reps,
      finish_seconds: value.finishSeconds,
    });
  }
  return { ok: true, rows };
}

/**
 * A save replaces exactly the scores it carries: the log's rows go and the
 * payload's are written, an empty list clearing them. Two statements, like the
 * exercise rows' replace; a failure between them leaves the log with its sets
 * and no scores, which the client's retry puts right.
 */
export async function replaceGroupScores(
  sessionLogId: string,
  rows: readonly GroupScoreRowInput[],
): Promise<void> {
  const { error: deleteErr } = await supabaseAdmin
    .from("session_log_group_scores")
    .delete()
    .eq("session_log_id", sessionLogId);
  if (deleteErr) {
    throw new Error(`Failed to clear group scores before re-insert: ${deleteErr.message}`);
  }
  if (rows.length === 0) return;
  const { error: insertErr } = await supabaseAdmin
    .from("session_log_group_scores")
    .insert(rows.map((row) => ({ ...row, session_log_id: sessionLogId })));
  if (insertErr) {
    throw new Error(`Failed to insert group scores: ${insertErr.message}`);
  }
}
