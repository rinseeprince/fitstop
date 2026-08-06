/**
 * Client Check-in Processing Service
 * Handles AI summary generation and post-submission processing for client check-ins
 */

import { generateCheckInSummary } from "@/services/ai-service";
import {
  getCheckInWithDetails,
  updateCheckInAISummary,
  getClientCheckIns
} from "@/services/check-in-service";
import { getClientById, updateClient } from "@/services/client-service";
import { updateClientBMR } from "@/services/bmr-service";
import { recordBodyMetrics } from "@/services/body-metrics-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getDailyLogs } from "@/services/daily-logs-service";
import { getHabitLogs } from "@/services/daily-habits-service";
import { getNutritionSummaryForPeriod } from "@/services/weekly-nutrition-service";
import {
  getExerciseSummariesForPeriod,
  getTrainingEventDetailsForPeriod,
} from "@/services/check-in-context-service";
import { calculateCheckInPeriod, getDateString } from "@/lib/date-helpers";
import type { SubmitCheckInRequest, CheckInFormData, Client } from "@/types/check-in";
import type { PeriodSnapshot } from "@/types/schedule";
import { getCoachUnitPreference } from "@/lib/viewer-preferences";

/**
 * Triggers AI summary generation for a completed check-in
 * This is an async operation that runs independently of the main submission flow
 * 
 * @param checkInId - The ID of the completed check-in
 * @param clientId - The client who submitted the check-in  
 * @param clientName - The client's name for personalized AI summary
 * @throws Error if AI summary generation fails
 */
export async function triggerAISummaryGeneration(
  checkInId: string,
  clientId: string,
  clientName: string
): Promise<void> {
  try {
    // Get current check-in with all details (session completions, highlights, etc.)
    const currentCheckIn = await getCheckInWithDetails(checkInId);

    if (!currentCheckIn) {
      throw new Error("Check-in not found");
    }

    // Get previous check-ins for comparison and trend analysis
    const { checkIns } = await getClientCheckIns(clientId, { limit: 5 });
    const previousCheckIns = checkIns.filter((ci) => ci.id !== checkInId);

    // Calculate date range using fixed 7-day period based on expectedCheckInDay
    const client = await getClientById(clientId);
    let startDate: Date;
    let endDate: Date;

    if (currentCheckIn.periodStart && currentCheckIn.periodEnd) {
      // Use stored period from check-in record
      startDate = new Date(currentCheckIn.periodStart + "T00:00:00");
      endDate = new Date(currentCheckIn.periodEnd + "T00:00:00");
    } else if (client?.expectedCheckInDay) {
      const { periodStart, periodEnd } = calculateCheckInPeriod(
        new Date(currentCheckIn.createdAt),
        client.expectedCheckInDay
      );
      startDate = new Date(periodStart + "T00:00:00");
      endDate = new Date(periodEnd + "T00:00:00");
    } else {
      // Fallback: 7 days ending on check-in date
      endDate = new Date(currentCheckIn.createdAt);
      startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 6);
    }

    const startDateStr = getDateString(startDate);
    const endDateStr = getDateString(endDate);
    
    // Fetch daily tracking context, weekly nutrition summary, and per-event
    // training detail for the period. trainingEventDetails defaults to [] on
    // failure so the AI training block degrades to the legacy workout count.
    let dailyLogs, habitLogs, weeklySummary;
    let trainingEventDetails: Awaited<ReturnType<typeof getTrainingEventDetailsForPeriod>> = [];
    // Session 6.3: per-exercise top-set lines, keyed by session_log_id. Derived
    // from the logged events' session_log ids; defaults to an empty Map so the
    // prompt degrades to per-event detail on any failure (non-blocking).
    let exerciseSummaries: Map<string, string[]> = new Map();
    try {
      const [logs, habits, periodSummary, eventDetails] = await Promise.all([
        getDailyLogs(clientId, startDateStr, endDateStr),
        getHabitLogs(clientId, startDateStr, endDateStr),
        getNutritionSummaryForPeriod(clientId, startDateStr, endDateStr),
        getTrainingEventDetailsForPeriod(clientId, startDateStr, endDateStr),
      ]);
      dailyLogs = logs;
      habitLogs = habits;
      weeklySummary = periodSummary;
      trainingEventDetails = eventDetails;

      const loggedSessionLogIds = eventDetails
        .filter((d) => d.logStatus === "logged")
        .map((d) => d.sessionLogId)
        .filter((id): id is string => Boolean(id));
      exerciseSummaries = await getExerciseSummariesForPeriod(loggedSessionLogIds);
    } catch (error) {
      // If daily tracking fetch fails, continue without it
      console.error('Error fetching daily tracking data:', error instanceof Error ? error.message : 'Unknown error');
      dailyLogs = undefined;
      habitLogs = undefined;
      weeklySummary = null;
      trainingEventDetails = [];
      exerciseSummaries = new Map();
    }

    // Read period snapshot if it was generated during submission
    const periodSnapshot = currentCheckIn.periodSnapshot as PeriodSnapshot | null ?? null;

    // This path is CLIENT-authenticated (the client just submitted), but the
    // coach is who reads the summary — so resolve the owning coach's unit, not
    // the request's principal. getViewerUnitPreference(request) would render a
    // coach's summary in whichever unit their client happens to prefer.
    const viewer = await getCoachUnitPreference(client?.coachId);

    // Generate AI summary with enhanced data including daily tracking
    const aiSummary = await generateCheckInSummary(
      currentCheckIn,
      previousCheckIns,
      clientName,
      dailyLogs,
      habitLogs,
      startDate,
      endDate,
      weeklySummary,
      periodSnapshot,
      trainingEventDetails,
      exerciseSummaries,
      viewer
    );

    // Update check-in with AI summary (v2 format)
    await updateCheckInAISummary(checkInId, aiSummary);
  } catch (error) {
    console.error(`Error in AI summary generation for check-in ${checkInId}:`, error instanceof Error ? error.message : "Unknown error");
    throw error;
  }
}

/**
 * Updates client metrics from check-in data and recalculates BMR/TDEE
 * This function ensures current_weight, current_body_fat_percentage, bmr, and tdee
 * are properly updated in the clients table after a check-in submission
 * 
 * @param client - The client object to update
 * @param checkInData - The check-in data containing new metrics
 * @throws Error if metrics update fails
 */
export async function updateClientMetricsFromCheckIn(
  client: Client,
  checkInData: SubmitCheckInRequest | CheckInFormData,
  checkInId?: string
): Promise<void> {
  try {
    const updates: Partial<{ currentWeight: number; currentBodyFatPercentage: number }> = {};

    // Update current weight if provided in check-in
    if (checkInData.weight !== undefined) {
      updates.currentWeight = checkInData.weight;
    }

    // Update current body fat if provided in check-in
    if (checkInData.bodyFatPercentage !== undefined) {
      updates.currentBodyFatPercentage = checkInData.bodyFatPercentage;
    }

    // Only update if we have new data
    if (Object.keys(updates).length > 0) {
      // Update client with new current metrics
      const updatedClient = await updateClient(client.id, updates);

      // Calculate and update BMR if we have all required data
      const bmr = updateClientBMR(updatedClient);
      let tdee: number | undefined;
      if (bmr !== null) {
        // Calculate TDEE (sedentary = BMR × 1.2)
        tdee = Math.round(bmr * 1.2);

        // TODO: Replace with server client once service layer auth pattern is established
        const { error: updateError } = await supabaseAdmin
          .from("clients")
          .update({ bmr, tdee })
          .eq("id", client.id);

        if (updateError) {
          console.error("Error updating BMR/TDEE:", updateError);
        }
      }

      // Dual-write to body_metrics (non-blocking)
      try {
        await recordBodyMetrics({
          clientId: client.id,
          weight: checkInData.weight,
          bodyFatPercentage: checkInData.bodyFatPercentage,
          bmr: bmr ?? undefined,
          tdee,
          source: "check_in",
          sourceId: checkInId,
        });
      } catch (dualWriteError) {
        console.error("Dual-write to body_metrics failed:", dualWriteError instanceof Error ? dualWriteError.message : "Unknown error");
      }
    }
  } catch (error) {
    console.error("Error updating client metrics from check-in:", error instanceof Error ? error.message : "Unknown error");
    throw error;
  }
}