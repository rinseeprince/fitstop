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
import type { CheckInTiming, OverviewBrief, UnreviewedCheckIn } from "@/types/coach-brief";

async function getUnreviewedCheckIn(clientId: string): Promise<UnreviewedCheckIn> {
  const { data, error } = await supabaseAdmin
    .from("check_ins")
    .select("id, created_at")
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
  return { id: data.id, submittedAt: data.created_at ?? "" };
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
 * an empty feed.
 *
 * Caller (the overview-brief route) has verified the coach owns this client.
 */
export const getOverviewBrief = async (
  coachId: string,
  clientId: string
): Promise<OverviewBrief> => {
  const lastViewedAt = await getLastViewedAt(coachId, clientId);
  const client = await getClientById(clientId);

  const [attentionAlerts, unreviewedCheckIn, activity, checkInTiming] = await Promise.all([
    evaluateSingleClientAlerts(coachId, clientId),
    getUnreviewedCheckIn(clientId),
    lastViewedAt
      ? getActivitySince(clientId, lastViewedAt, client?.weightUnit)
      : Promise.resolve([]),
    getCheckInTiming(client, clientId),
  ]);

  return {
    lastViewedAt,
    waitingOnYou: { unreviewedCheckIn, attentionAlerts },
    activity,
    checkInTiming,
  };
};
