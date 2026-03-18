/**
 * Weekly Nutrition Backfill Service
 * Handles backfilling weekly summaries from existing daily logs.
 */

import { supabaseAdmin } from "./supabase-admin";
import { getWeekStart } from "@/lib/date-helpers";
import { upsertWeeklySummary } from "./weekly-nutrition-service";

/**
 * Backfills weekly summaries from all existing daily_logs for a client.
 * Finds distinct weeks with data, skips weeks that already have summaries.
 */
export async function backfillWeeklySummariesForClient(
  clientId: string,
  earliestWeekStart?: string
): Promise<void> {
  // Get all dates with daily logs for this client
  let query = supabaseAdmin
    .from("daily_logs")
    .select("date")
    .eq("client_id", clientId)
    .order("date", { ascending: true });

  if (earliestWeekStart) {
    query = query.gte("date", earliestWeekStart);
  }

  const { data: logDates, error: datesError } = await query;

  if (datesError || !logDates?.length) return;

  // Collect distinct week start dates
  const weekStarts = new Set<string>();
  for (const row of logDates) {
    weekStarts.add(getWeekStart(row.date));
  }

  // Check which weeks already have summaries
  const { data: existing } = await supabaseAdmin
    .from("nutrition_weekly_summaries")
    .select("week_start_date")
    .eq("client_id", clientId);

  const existingWeeks = new Set((existing || []).map((r) => r.week_start_date));

  // Backfill missing weeks (cap at 12 to bound parallel DB operations)
  const MAX_BACKFILL_WEEKS = 12;
  const missing = [...weekStarts].filter((ws) => !existingWeeks.has(ws)).slice(0, MAX_BACKFILL_WEEKS);
  await Promise.all(
    missing.map((weekStart) =>
      upsertWeeklySummary(clientId, weekStart).catch((err) => {
        console.error(`Backfill failed for week ${weekStart}:`, err instanceof Error ? err.message : "Unknown error");
      })
    )
  );
}
