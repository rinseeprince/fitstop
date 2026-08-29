import { supabaseAdmin } from "./supabase-admin";
import { evaluateSingleClientAlerts } from "./attention-feed-service";
import { getLastViewedAt } from "./coach-client-views-service";
import { getActivitySince } from "./client-activity-feed-service";
import { getClientById } from "./client-service";
import { listBlocks } from "./client-blocks-service";
import { getClientTodayString } from "./today-service";
import {
  resolveCheckInDue,
  getDaysUntilOrPastDue,
  isClientOverdue,
} from "./check-in-tracking-service";
import { formatDateISO } from "@/lib/date-helpers";
import { UNREVIEWED_CHECK_IN_STATUSES } from "@/lib/constants";
import { deriveBlockEnding } from "@/lib/blocks/block-derivations";
import type { Client } from "@/types/check-in";
import type {
  BlockEnding,
  CheckInTiming,
  OverviewBrief,
  UnreviewedCheckIn,
} from "@/types/coach-brief";

async function getUnreviewedCheckIn(clientId: string): Promise<UnreviewedCheckIn> {
  const { data, error } = await supabaseAdmin
    .from("check_ins")
    .select("id, created_at")
    .eq("client_id", clientId)
    .in("status", UNREVIEWED_CHECK_IN_STATUSES)
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
 * The block-ending coach-action row: fires while the current journey block is
 * inside its final 7 days. Anchored on the CLIENT's calendar day via
 * getClientTodayString — block dates live on the client's calendar, the same
 * anchor every blocks route uses. Log-and-null like getUnreviewedCheckIn: a
 * blocks read failure degrades the row, never the whole Overview.
 */
async function getBlockEnding(clientId: string): Promise<BlockEnding> {
  try {
    const [blocks, clientToday] = await Promise.all([
      listBlocks(clientId),
      getClientTodayString(clientId),
    ]);
    const ending = deriveBlockEnding(blocks, clientToday);
    if (!ending) return null;
    return {
      blockName: ending.name,
      endsOn: ending.endsOn,
      nextBlockName: ending.nextName,
    };
  } catch (error) {
    console.error("Failed to derive the block-ending row:", error);
    return null;
  }
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

  // Only for `lastSubmittedAt`. The due date no longer has to be reconstructed
  // from what the client last submitted — it is stored — so the last check-in
  // is not attached to the client for the resolver any more.
  const { data: latest, error } = await supabaseAdmin
    .from("check_ins")
    .select("created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Failed to read latest check-in for timing:", error);
  }

  const nextExpected = resolveCheckInDue(client);

  return {
    frequency,
    lastSubmittedAt: latest?.created_at ?? null,
    nextDueDate: nextExpected ? formatDateISO(nextExpected) : null,
    daysUntilDue: nextExpected ? getDaysUntilOrPastDue(client) : null,
    isOverdue: isClientOverdue(client),
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

  const [attentionAlerts, unreviewedCheckIn, activity, checkInTiming, blockEnding] =
    await Promise.all([
      evaluateSingleClientAlerts(coachId, clientId),
      getUnreviewedCheckIn(clientId),
      lastViewedAt
        ? getActivitySince(clientId, lastViewedAt)
        : Promise.resolve([]),
      getCheckInTiming(client, clientId),
      getBlockEnding(clientId),
    ]);

  return {
    lastViewedAt,
    waitingOnYou: { unreviewedCheckIn, attentionAlerts, blockEnding },
    activity,
    checkInTiming,
  };
};
