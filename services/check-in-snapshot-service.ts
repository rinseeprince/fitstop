/**
 * Check-In Snapshot Service
 * Generates and freezes a period snapshot at check-in submission time.
 * The snapshot captures the day-by-day training schedule and nutrition summary
 * so historical check-ins survive future plan changes. It is the ONE freeze of
 * a period's nutrition targets: the food log stores what the client ate and
 * nothing else, and every day's target here is the computed day at the
 * instant of submission.
 */

import { supabaseAdmin } from "./supabase-admin";
import { fetchNutritionLogsForPeriod } from "./schedule-data-service";
import { getEventsForDateRange } from "./training-event-service";
import { getNutritionTargetsForDateRange } from "./nutrition-days-service";
import { mapEventsToScheduleDays } from "@/utils/training-event-helpers";
import { buildNutritionSummary } from "@/utils/nutrition-period-summary";
import { expandDateRange } from "@/lib/date-helpers";
import type { PeriodSnapshot } from "@/types/schedule";

export async function generateAndSaveCheckInSnapshot(
  checkInId: string,
  clientId: string,
  periodStart: string,
  periodEnd: string
): Promise<void> {
  const dates = expandDateRange(periodStart, periodEnd);

  // Fetch all data in parallel
  const [events, nutritionLogs, targets] = await Promise.all([
    getEventsForDateRange(clientId, periodStart, periodEnd),
    fetchNutritionLogsForPeriod(clientId, periodStart, periodEnd),
    getNutritionTargetsForDateRange(clientId, periodStart, periodEnd),
  ]);

  // Build training schedule from events
  const training = mapEventsToScheduleDays(dates, events);

  const nutrition = buildNutritionSummary(dates, nutritionLogs, targets);

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
