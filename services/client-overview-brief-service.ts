import { supabaseAdmin } from "./supabase-admin";
import { evaluateSingleClientAlerts } from "./attention-feed-service";
import { getLastViewedAt } from "./coach-client-views-service";
import { getActivitySince } from "./client-activity-feed-service";
import { getClientById } from "./client-service";
import {
  calculateNextExpectedCheckIn,
  getDaysUntilOrPastDue,
  isClientOverdue,
} from "./check-in-tracking-service";
import { formatDateISO } from "@/lib/date-helpers";
import type { Client } from "@/types/check-in";
import type {
  CheckInTiming,
  OverviewBrief,
  SinceLastVisit,
  UnreviewedCheckIn,
} from "@/types/coach-brief";

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
  const submittedAt = data.created_at ?? "";
  return { id: data.id, submittedAt, createdAt: submittedAt, status: data.status };
}

/**
 * Check-in schedule state via the existing tracking service (client-local
 * today, period math untouched). Null when the client has no schedule.
 */
async function getCheckInTiming(
  client: Client | null,
  clientId: string
): Promise<CheckInTiming | null> {
  if (!client) return null;
  const frequency = client.checkInFrequency ?? "weekly";
  if (frequency === "none") return null;

  const { data: latest, error } = await supabaseAdmin
    .from("check_ins")
    .select("created_at, period_end")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Failed to read latest check-in for timing:", error);
  }

  // Attach the last check-in the way getClientsForCoach does so the tracking
  // service's "already checked in this period" branch can fire.
  const clientForTiming: Client & { lastCheckInDate?: string; lastCheckInPeriodEnd?: string } = {
    ...client,
    lastCheckInDate: latest?.created_at ?? undefined,
    lastCheckInPeriodEnd: latest?.period_end ?? undefined,
  };

  const nextExpected = calculateNextExpectedCheckIn(clientForTiming);

  return {
    frequency,
    expectedCheckInDay: client.expectedCheckInDay ?? null,
    lastSubmittedAt: latest?.created_at ?? null,
    nextDueDate: nextExpected ? formatDateISO(nextExpected) : null,
    daysUntilDue: nextExpected ? getDaysUntilOrPastDue(clientForTiming) : null,
    isOverdue: isClientOverdue(clientForTiming),
  };
}

/**
 * Builds the coach pre-session brief for one client (Session 7.6; activity feed
 * + check-in timing added by the Overview redesign Session 1).
 *
 * READ-ONLY: everything is computed against the stored last_viewed_at anchor
 * and the anchor is NOT advanced here — it moves only via
 * POST …/overview-brief/seen ("Mark seen"). First visit (null anchor) returns
 * an empty feed and zero deltas.
 *
 * Caller (the overview-brief route) has verified the coach owns this client.
 */
export const getOverviewBrief = async (
  coachId: string,
  clientId: string
): Promise<OverviewBrief> => {
  const lastViewedAt = await getLastViewedAt(coachId, clientId);
  const client = await getClientById(clientId);

  const [attentionAlerts, unreviewedCheckIn, sinceLastVisit, activity, checkInTiming] =
    await Promise.all([
      evaluateSingleClientAlerts(coachId, clientId),
      getUnreviewedCheckIn(clientId),
      lastViewedAt ? getSinceLastVisit(clientId, lastViewedAt) : Promise.resolve(ZERO_DELTAS),
      lastViewedAt
        ? getActivitySince(clientId, lastViewedAt, client?.weightUnit)
        : Promise.resolve([]),
      getCheckInTiming(client, clientId),
    ]);

  return {
    lastViewedAt,
    waitingOnYou: { unreviewedCheckIn, attentionAlerts },
    activity,
    sinceLastVisit,
    checkInTiming,
  };
};
