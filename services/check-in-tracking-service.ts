/**
 * Check-In Tracking Service
 * Handles calculations for check-in schedules, overdue detection, and client adherence
 *
 * Pure schedule maths over `getClientsForCoach` — no direct table access. (The
 * one direct query here, the single-client missed-period lookup, had no caller
 * and was removed in the 2026-08-25 dead-code sweep.)
 */

import { getClientsForCoach } from "./client-service";

import {
  resolveCheckInDue,
  getDaysUntilOrPastDue,
  getOverdueSeverity,
} from "@/lib/check-in-schedule";

// The schedule maths lives in lib/ so the browser can run it too (see that
// module). Re-exported here so this service stays the one import site every
// existing caller already uses.
export {
  getFrequencyInDays,
  resolveCheckInDue,
  isClientOverdue,
  getDaysUntilOrPastDue,
} from "@/lib/check-in-schedule";
import type {
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
      const nextExpectedCheckIn = resolveCheckInDue(client);
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
      const nextExpectedCheckIn = resolveCheckInDue(client);
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

