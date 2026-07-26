import { supabaseAdmin } from "./supabase-admin";
import { countEventsInRange } from "./training-event-service";
import { getCoachTodayString } from "./today-service";
import { getTrainingWeekStart, getTrainingWeekEnd } from "@/lib/date-helpers";
import type { TrainingWeekSummary } from "@/types/history";

/**
 * The coach's current-week training summary — extracted VERBATIM from the
 * /history/training/summary route so the Overview plan-summary endpoint reuses
 * the exact same math (Overview redesign Session 1). Both callers consume this;
 * do not fork the calculation.
 *
 * Semantics (unchanged): coach-local "current week" anchored on the client's
 * check-in day; completed counts FULL session-log completions only; planned
 * counts training events up to today (can't miss a future session).
 */
export type TrainingWeekSummaryWithWindow = TrainingWeekSummary & {
  weekStart: string;
  weekEnd: string;
};

export const getTrainingWeekSummary = async (
  clientId: string,
  coachId: string
): Promise<TrainingWeekSummaryWithWindow> => {
  // Fetch client's check-in day for correct week boundaries
  const { data: clientRow } = await supabaseAdmin
    .from("clients")
    .select("expected_check_in_day")
    .eq("id", clientId)
    .single();

  const checkInDay = clientRow?.expected_check_in_day ?? "monday";

  // Coach-local "current week": this is the coach's summary view.
  const today = await getCoachTodayString(coachId);
  const weekStart = getTrainingWeekStart(today, checkInDay);
  const weekEnd = getTrainingWeekEnd(today, checkInDay);

  // completed_at is TIMESTAMPTZ, so use time boundaries to include full days
  const { data: weekLogs, error: weekError } = await supabaseAdmin
    .from("session_logs")
    .select("completion_quality")
    .eq("client_id", clientId)
    .gte("completed_at", weekStart + "T00:00:00")
    .lte("completed_at", weekEnd + "T23:59:59");

  if (weekError) {
    console.error("Error fetching training week logs:", weekError);
    throw new Error("Failed to fetch training summary");
  }

  const completed = (weekLogs || []).filter(
    (r) => r.completion_quality === "full"
  ).length;

  // Count planned sessions from training events (cap at today — can't miss a future session)
  const effectiveEnd = today < weekEnd ? today : weekEnd;
  const plannedUpToToday = await countEventsInRange(clientId, weekStart, effectiveEnd);
  const totalPlanned = plannedUpToToday;

  const missed = Math.max(0, plannedUpToToday - completed);

  return { completed, totalPlanned, plannedUpToToday, missed, weekStart, weekEnd };
};
