/**
 * Check-In Tracking Service
 * Handles calculations for check-in schedules, overdue detection, and client adherence
 *
 * supabaseAdmin required throughout: this service is called from unauthenticated
 * token-based check-in routes (no session for RLS) and coach routes querying
 * across multiple clients
 */

import { supabaseAdmin } from "./supabase-admin";
import { getClientsForCoach } from "./client-service";
import { calculateCheckInPeriod, getTodayInTimezone } from "@/lib/date-helpers";
import {
  calculateNextExpectedCheckIn,
  getDaysUntilOrPastDue,
  getOverdueSeverity,
} from "@/lib/check-in-schedule";

// The schedule maths lives in lib/ so the browser can run it too (see that
// module). Re-exported here so this service stays the one import site every
// existing caller already uses.
export {
  getFrequencyInDays,
  calculateNextExpectedCheckIn,
  isClientOverdue,
  getDaysUntilOrPastDue,
  getOverdueSeverity,
} from "@/lib/check-in-schedule";
import type {
  DayOfWeek,
  OverdueClient,
  ClientDueSoon,
} from "@/types/check-in";

/**
 * Get all overdue clients for a coach
 * Returns clients sorted by most overdue first
 */
export async function getOverdueClients(coachId: string): Promise<OverdueClient[]> {
  const clients = await getClientsForCoach(coachId);

  const overdueClients = clients
    .filter((client) => client.active && client.checkInFrequency !== "none")
    .map((client) => {
      const nextExpectedCheckIn = calculateNextExpectedCheckIn(client);
      const daysOverdue = getDaysUntilOrPastDue(client);
      const severity = getOverdueSeverity(daysOverdue);

      return {
        ...client,
        nextExpectedCheckIn,
        daysOverdue,
        severity,
      };
    })
    .filter((client) => client.daysOverdue > 0) // Only include overdue clients (not due-today)
    .sort((a, b) => b.daysOverdue - a.daysOverdue); // Most overdue first

  return overdueClients;
}

/**
 * Get clients whose check-ins are due soon (within next 48 hours)
 * Returns clients sorted by soonest due first
 */
export async function getClientsDueSoon(coachId: string): Promise<ClientDueSoon[]> {
  const clients = await getClientsForCoach(coachId);

  const clientsDueSoon = clients
    .filter((client) => client.active && client.checkInFrequency !== "none")
    .map((client) => {
      const nextExpectedCheckIn = calculateNextExpectedCheckIn(client);
      const daysUntilDue = getDaysUntilOrPastDue(client);

      return {
        ...client,
        nextExpectedCheckIn,
        daysUntilDue,
      };
    })
    .filter((client) => client.daysUntilDue < 0 && client.daysUntilDue >= -2)
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue); // Soonest first

  return clientsDueSoon;
}

export type MissedCheckInPeriod = {
  periodStart: string;
  periodEnd: string;
};

/**
 * Get list of missed check-in periods for a client.
 * A period is "missed" if no check-in exists for it and the grace window has passed
 * (i.e., the next period's end date has arrived).
 *
 * Computed at query time — no cron job needed.
 */
export async function getMissedCheckInPeriods(
  clientId: string,
  expectedCheckInDay: DayOfWeek,
  since: Date,
  clientTimezone: string
): Promise<MissedCheckInPeriod[]> {
  // Get all check-in dates for this client since the given date
  const { data: checkIns, error } = await supabaseAdmin
    .from("check_ins")
    .select("created_at, period_start")
    .eq("client_id", clientId)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch check-ins: ${error.message}`);
  }

  // Build a set of covered period_start dates from existing check-ins
  const coveredPeriods = new Set<string>();
  for (const ci of checkIns || []) {
    if (ci.period_start) {
      coveredPeriods.add(ci.period_start);
    } else {
      // For legacy check-ins without stored period, compute it
      const { periodStart } = calculateCheckInPeriod(
        new Date(ci.created_at!),
        expectedCheckInDay
      );
      coveredPeriods.add(periodStart);
    }
  }

  // Walk through every expected period from `since` until the client's today
  const today = getTodayInTimezone(clientTimezone);
  const missed: MissedCheckInPeriod[] = [];

  // Start from the first period that includes `since`
  let { periodStart, periodEnd } = calculateCheckInPeriod(since, expectedCheckInDay);
  let cursor = new Date(periodEnd + "T00:00:00");

  while (cursor <= today) {
    // Grace window: the period is only "missed" once the next period's end has arrived
    const nextPeriodEnd = new Date(cursor);
    nextPeriodEnd.setDate(nextPeriodEnd.getDate() + 7);

    if (nextPeriodEnd <= today && !coveredPeriods.has(periodStart)) {
      missed.push({ periodStart, periodEnd });
    }

    // Advance to next period
    cursor.setDate(cursor.getDate() + 7);
    const nextPeriod = calculateCheckInPeriod(cursor, expectedCheckInDay);
    periodStart = nextPeriod.periodStart;
    periodEnd = nextPeriod.periodEnd;
    cursor = new Date(periodEnd + "T00:00:00");
  }

  return missed;
}
