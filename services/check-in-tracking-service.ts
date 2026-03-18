/**
 * Check-In Tracking Service
 * Handles calculations for check-in schedules, overdue detection, and client adherence
 *
 * supabaseAdmin required throughout: this service is called from unauthenticated
 * token-based check-in routes (no session for RLS) and coach routes querying
 * across multiple clients
 */

import { supabaseAdmin } from "./supabase-admin";
import { getClientsForCoach, type ClientWithCheckInInfo } from "./client-service";
import {
  addDays,
  differenceInDays,
  parseISODate,
  calculateCheckInPeriod,
} from "@/lib/date-utils";
import type {
  Client,
  CheckInFrequency,
  DayOfWeek,
  OverdueSeverity,
  OverdueClient,
  ClientDueSoon,
} from "@/types/check-in";

/**
 * Get frequency in days for a given check-in frequency
 */
export function getFrequencyInDays(
  frequency: CheckInFrequency,
  customDays?: number
): number {
  const frequencyMap: Record<CheckInFrequency, number> = {
    weekly: 7,
    biweekly: 14,
    monthly: 30,
    custom: customDays ?? 7,
    none: 0,
  };

  return frequencyMap[frequency];
}

/**
 * Calculate when the next check-in is expected for a client.
 * Uses period-based calculation so the expected date always reflects
 * the current period, not the first missed one.
 * Returns null if client has no check-in schedule (frequency = 'none')
 */
export function calculateNextExpectedCheckIn(client: Client | ClientWithCheckInInfo): Date | null {
  const frequency = client.checkInFrequency ?? "weekly";

  if (frequency === "none") {
    return null;
  }

  if (client.expectedCheckInDay) {
    const today = new Date();
    const { periodEnd } = calculateCheckInPeriod(today, client.expectedCheckInDay);

    // Use period_end from the last check-in (accurate) with fallback to created_at
    const lastPeriodEnd = ("lastCheckInPeriodEnd" in client && client.lastCheckInPeriodEnd)
      ? client.lastCheckInPeriodEnd
      : undefined;

    if (lastPeriodEnd === periodEnd) {
      // Already checked in for current period — next expected is next week
      const nextEnd = new Date(periodEnd + "T00:00:00");
      nextEnd.setDate(nextEnd.getDate() + 7);
      return nextEnd;
    }

    // Not checked in for current period — current period end is the expected date
    return new Date(periodEnd + "T00:00:00");
  }

  // Fallback for clients without expectedCheckInDay: loop forward from last check-in
  const lastCheckInDate = ("lastCheckInDate" in client && client.lastCheckInDate)
    ? parseISODate(client.lastCheckInDate)
    : parseISODate(client.createdAt);

  const frequencyDays = getFrequencyInDays(frequency, client.checkInFrequencyDays);
  let nextDate = addDays(lastCheckInDate, frequencyDays);
  const today = new Date();
  while (nextDate < today) {
    nextDate = addDays(nextDate, frequencyDays);
  }

  return nextDate;
}

/**
 * Check if a client is overdue for their check-in
 */
export function isClientOverdue(client: Client): boolean {
  const nextExpected = calculateNextExpectedCheckIn(client);

  if (!nextExpected) {
    return false; // No schedule = not overdue
  }

  const now = new Date();
  return now > nextExpected;
}

/**
 * Get days until check-in is due (negative) or days overdue (positive)
 * Returns 0 if no check-in schedule
 */
export function getDaysUntilOrPastDue(client: Client): number {
  const nextExpected = calculateNextExpectedCheckIn(client);

  if (!nextExpected) {
    return 0;
  }

  const now = new Date();
  return differenceInDays(now, nextExpected);
}

/**
 * Categorize overdue severity based on days overdue
 */
export function getOverdueSeverity(daysOverdue: number): OverdueSeverity {
  if (daysOverdue < -3) return "upcoming";
  if (daysOverdue < 0) return "due_soon";
  if (daysOverdue <= 3) return "overdue";
  return "critically_overdue";
}

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
    .filter((client) => client.daysOverdue >= 0) // Only include overdue clients
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
  since: Date
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

  // Walk through every expected period from `since` until today
  const today = new Date();
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
