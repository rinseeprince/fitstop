import { supabaseAdmin } from "./supabase-admin";
import { evaluateSingleClientAlerts } from "./attention-feed-service";
import { getLastViewedAt, upsertLastViewed } from "./coach-client-views-service";
import type { OverviewBrief, SinceLastVisit, UnreviewedCheckIn } from "@/types/coach-brief";

const ZERO_DELTAS: SinceLastVisit = {
  newCheckIns: 0,
  newLogs: 0,
  newBodyMetrics: 0,
  newWorkoutsLogged: 0,
  eventStatusChanges: 0,
};

/** Reads a head-count result; returns 0 (logged) on failure so the brief degrades. */
function readCount(
  result: { count: number | null; error: { message: string } | null },
  label: string
): number {
  if (result.error) {
    console.error(`Failed to count ${label} since last visit:`, result.error);
    return 0;
  }
  return result.count ?? 0;
}

async function getSinceLastVisit(clientId: string, since: string): Promise<SinceLastVisit> {
  const [checkIns, logs, metrics, workouts, events] = await Promise.all([
    supabaseAdmin
      .from("check_ins")
      .select("*", { count: "exact", head: true })
      .eq("client_id", clientId)
      .gt("created_at", since),
    supabaseAdmin
      .from("daily_logs")
      .select("*", { count: "exact", head: true })
      .eq("client_id", clientId)
      .gt("updated_at", since),
    supabaseAdmin
      .from("body_metrics")
      .select("*", { count: "exact", head: true })
      .eq("client_id", clientId)
      .gt("created_at", since),
    supabaseAdmin
      .from("session_logs")
      .select("*", { count: "exact", head: true })
      .eq("client_id", clientId)
      .gt("created_at", since),
    // A scheduled→completed/partial/missed/skipped transition bumps updated_at.
    supabaseAdmin
      .from("training_events")
      .select("*", { count: "exact", head: true })
      .eq("client_id", clientId)
      .gt("updated_at", since)
      .neq("status", "scheduled"),
  ]);

  return {
    newCheckIns: readCount(checkIns, "check_ins"),
    newLogs: readCount(logs, "daily_logs"),
    newBodyMetrics: readCount(metrics, "body_metrics"),
    newWorkoutsLogged: readCount(workouts, "session_logs"),
    eventStatusChanges: readCount(events, "training_events"),
  };
}

async function getUnreviewedCheckIn(clientId: string): Promise<UnreviewedCheckIn> {
  const { data, error } = await supabaseAdmin
    .from("check_ins")
    .select("id, created_at, status")
    .eq("client_id", clientId)
    .in("status", ["pending", "ai_processed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Failed to read unreviewed check-in:", error);
    return null;
  }
  if (!data) return null;
  return { id: data.id, createdAt: data.created_at ?? "", status: data.status };
}

/**
 * Builds the coach pre-session brief for one client (Session 7.6).
 *
 * ORDER MATTERS: read `last_viewed_at` FIRST, compute the since-last-visit deltas
 * against it, THEN upsert the new view timestamp LAST — upserting first would make
 * "since your last visit" always empty.
 *
 * Caller (the overview-brief route) has verified the coach owns this client.
 */
export const getOverviewBrief = async (
  coachId: string,
  clientId: string
): Promise<OverviewBrief> => {
  const lastViewedAt = await getLastViewedAt(coachId, clientId);

  const [attentionAlerts, unreviewedCheckIn, sinceLastVisit] = await Promise.all([
    evaluateSingleClientAlerts(coachId, clientId),
    getUnreviewedCheckIn(clientId),
    // First visit (no prior timestamp) → no deltas; the UI shows a first-visit state.
    lastViewedAt ? getSinceLastVisit(clientId, lastViewedAt) : Promise.resolve(ZERO_DELTAS),
  ]);

  // Record the view LAST, after the deltas above were computed against the prior value.
  await upsertLastViewed(coachId, clientId);

  return {
    lastViewedAt,
    waitingOnYou: { unreviewedCheckIn, attentionAlerts },
    sinceLastVisit,
  };
};
