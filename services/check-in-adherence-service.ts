/**
 * Check-In Adherence Service
 * Handles calculations for check-in adherence rates, streaks, and stats
 *
 * supabaseAdmin required throughout: this service is called from unauthenticated
 * token-based check-in routes (no session for RLS) and coach routes querying
 * across multiple clients
 */

import { supabaseAdmin } from "./supabase-admin";
import { getClientById } from "./client-service";
import {
  addDays,
  differenceInDays,
  parseISODate,
  getTodayInTimezone,
} from "@/lib/date-helpers";
import { getFrequencyInDays } from "./check-in-tracking-service";
import type { ClientAdherenceStats } from "@/types/check-in";

/**
 * Get count of check-ins for a client
 */
export async function getCheckInCount(clientId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("check_ins")
    .select("*", { count: "exact", head: true })
    .eq("client_id", clientId);

  if (error) {
    throw new Error(`Failed to get check-in count: ${error.message}`);
  }

  return count ?? 0;
}

/**
 * Calculate check-in adherence rate for a client
 * Returns percentage (0-100) of expected check-ins that were completed
 */
export async function calculateCheckInAdherence(clientId: string): Promise<number> {
  const client = await getClientById(clientId);

  if (!client) {
    return 0;
  }

  // Client-local today: "days since signup" is a count on the client's
  // check-in calendar, same anchor as the tracking fns.
  const accountAge = differenceInDays(
    getTodayInTimezone(client.timezone),
    parseISODate(client.createdAt)
  );
  const frequencyDays = getFrequencyInDays(
    client.checkInFrequency ?? "weekly",
    client.checkInFrequencyDays
  );

  // If no check-in schedule, return 100% adherence
  if (frequencyDays === 0) {
    return 100;
  }

  // Calculate expected number of check-ins
  const expectedCount = Math.floor(accountAge / frequencyDays);

  // If account is too new to have expected check-ins yet
  if (expectedCount === 0) {
    return 100;
  }

  // Get actual check-in count
  const actualCount = await getCheckInCount(clientId);

  // Calculate adherence rate (capped at 100%)
  const adherenceRate = (actualCount / expectedCount) * 100;
  return Math.min(adherenceRate, 100);
}

/**
 * Calculate current streak (consecutive on-time check-ins)
 */
export async function calculateCurrentStreak(clientId: string): Promise<number> {
  const client = await getClientById(clientId);

  if (!client) {
    return 0;
  }

  // Get all check-ins ordered by date
  const { data: checkIns, error } = await supabaseAdmin
    .from("check_ins")
    .select("created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  if (error || !checkIns || checkIns.length === 0) {
    return 0;
  }

  const frequencyDays = getFrequencyInDays(
    client.checkInFrequency ?? "weekly",
    client.checkInFrequencyDays
  );

  if (frequencyDays === 0) {
    return 0;
  }

  let streak = 0;
  let expectedDate = getTodayInTimezone(client.timezone);

  for (const checkIn of checkIns) {
    const checkInDate = parseISODate(checkIn.created_at!);
    const daysDifference = differenceInDays(expectedDate, checkInDate);

    // If check-in is within acceptable range (on time or up to 2 days late)
    if (daysDifference <= frequencyDays + 2) {
      streak++;
      expectedDate = addDays(checkInDate, -frequencyDays);
    } else {
      // Streak broken
      break;
    }
  }

  return streak;
}

/**
 * Calculate longest streak ever achieved
 */
export async function calculateLongestStreak(clientId: string): Promise<number> {
  const client = await getClientById(clientId);

  if (!client) {
    return 0;
  }

  const { data: checkIns, error } = await supabaseAdmin
    .from("check_ins")
    .select("created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: true });

  if (error || !checkIns || checkIns.length === 0) {
    return 0;
  }

  const frequencyDays = getFrequencyInDays(
    client.checkInFrequency ?? "weekly",
    client.checkInFrequencyDays
  );

  if (frequencyDays === 0) {
    return 0;
  }

  let longestStreak = 0;
  let currentStreak = 1;
  let previousDate = parseISODate(checkIns[0].created_at!);

  for (let i = 1; i < checkIns.length; i++) {
    const currentDate = parseISODate(checkIns[i].created_at!);
    const daysDifference = differenceInDays(currentDate, previousDate);

    if (daysDifference <= frequencyDays + 2) {
      currentStreak++;
    } else {
      longestStreak = Math.max(longestStreak, currentStreak);
      currentStreak = 1;
    }

    previousDate = currentDate;
  }

  return Math.max(longestStreak, currentStreak);
}

/**
 * Update all adherence stats for a client
 * Called after a check-in is submitted or periodically via cron
 */
export async function updateClientAdherenceStats(clientId: string): Promise<void> {
  const client = await getClientById(clientId);

  if (!client) {
    throw new Error(`Client not found: ${clientId}`);
  }

  const adherenceRate = await calculateCheckInAdherence(clientId);
  const currentStreak = await calculateCurrentStreak(clientId);
  const longestStreak = await calculateLongestStreak(clientId);
  const actualCount = await getCheckInCount(clientId);

  const accountAge = differenceInDays(
    getTodayInTimezone(client.timezone),
    parseISODate(client.createdAt)
  );
  const frequencyDays = getFrequencyInDays(
    client.checkInFrequency ?? "weekly",
    client.checkInFrequencyDays
  );
  const expectedCount = frequencyDays > 0 ? Math.floor(accountAge / frequencyDays) : 0;

  const { error } = await supabaseAdmin
    .from("clients")
    .update({
      total_check_ins_expected: expectedCount,
      total_check_ins_completed: actualCount,
      check_in_adherence_rate: adherenceRate,
      current_streak: currentStreak,
      longest_streak: Math.max(longestStreak, client.longestStreak ?? 0),
      updated_at: new Date().toISOString(),
    })
    .eq("id", clientId);

  if (error) {
    throw new Error(`Failed to update adherence stats: ${error.message}`);
  }
}

/**
 * Get adherence stats for a client
 */
export async function getClientAdherenceStats(
  clientId: string
): Promise<ClientAdherenceStats> {
  const client = await getClientById(clientId);

  if (!client) {
    throw new Error(`Client not found: ${clientId}`);
  }

  return {
    totalCheckInsExpected: client.totalCheckInsExpected ?? 0,
    totalCheckInsCompleted: client.totalCheckInsCompleted ?? 0,
    checkInAdherenceRate: client.checkInAdherenceRate ?? 0,
    currentStreak: client.currentStreak ?? 0,
    longestStreak: client.longestStreak ?? 0,
  };
}
