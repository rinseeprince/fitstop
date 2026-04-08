/**
 * Check-In Snapshot Service
 * Generates and freezes a period snapshot at check-in submission time.
 * The snapshot captures the day-by-day training schedule and nutrition summary
 * so historical check-ins survive future plan changes.
 */

import { supabaseAdmin } from "./supabase-admin";
import {
  fetchTrainingDataForPeriod,
  fetchNutritionDataForPeriod,
} from "./schedule-data-service";
import { getEventsForDateRange } from "./training-event-service";
import { mapEventsToScheduleDays } from "@/utils/training-event-helpers";
import { buildNutritionSummary } from "@/utils/nutrition-period-summary";
import type { PeriodSnapshot } from "@/types/schedule";

/**
 * Generate date array from start to end (inclusive).
 */
function generateDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(start + "T00:00:00");
  const endDate = new Date(end + "T00:00:00");

  while (cursor <= endDate) {
    const year = cursor.getFullYear();
    const month = String(cursor.getMonth() + 1).padStart(2, "0");
    const day = String(cursor.getDate()).padStart(2, "0");
    dates.push(`${year}-${month}-${day}`);
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

export async function generateAndSaveCheckInSnapshot(
  checkInId: string,
  clientId: string,
  periodStart: string,
  periodEnd: string
): Promise<void> {
  const dates = generateDateRange(periodStart, periodEnd);

  // Fetch all data in parallel
  const [events, trainingData, nutritionData] = await Promise.all([
    getEventsForDateRange(clientId, periodStart, periodEnd),
    fetchTrainingDataForPeriod(clientId, periodStart, periodEnd),
    fetchNutritionDataForPeriod(clientId, periodStart, periodEnd),
  ]);

  // Build training schedule from events
  const training = mapEventsToScheduleDays(dates, events);

  const nutrition = buildNutritionSummary(
    dates,
    nutritionData.plans,
    nutritionData.nutritionLogs,
    trainingData.plans
  );

  const snapshot: PeriodSnapshot = {
    generatedAt: new Date().toISOString(),
    training,
    nutrition,
  };

  // Write snapshot to check_ins — never updated after creation
  // Uses supabaseAdmin: writing to check_ins in unauthenticated token context (RLS exception 3)
  const { error } = await supabaseAdmin
    .from("check_ins")
    .update({ period_snapshot: JSON.parse(JSON.stringify(snapshot)) })
    .eq("id", checkInId);

  if (error) {
    throw new Error(`Failed to save period snapshot: ${error.message}`);
  }
}
