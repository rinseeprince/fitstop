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
import { updateClient } from "@/services/client-service";
import { updateClientBMR } from "@/services/bmr-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getDailyLogs } from "@/services/daily-logs-service";
import { getHabitLogs } from "@/services/daily-habits-service";
import type { SubmitCheckInRequest, CheckInFormData } from "@/types/check-in";

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

    // Calculate date range for daily tracking context
    const endDate = new Date(currentCheckIn.createdAt);
    let startDate: Date;
    
    if (previousCheckIns.length > 0) {
      // Start from day after the most recent previous check-in
      startDate = new Date(previousCheckIns[0].createdAt);
      startDate.setDate(startDate.getDate() + 1);
    } else {
      // No previous check-in, look back 7 days
      startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 6);
    }
    
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    
    // Fetch daily tracking context for the period
    let dailyLogs, habitLogs;
    try {
      [dailyLogs, habitLogs] = await Promise.all([
        getDailyLogs(clientId, startDateStr, endDateStr),
        getHabitLogs(clientId, startDateStr, endDateStr),
      ]);
    } catch (error) {
      // If daily tracking fetch fails, continue without it
      console.error('Error fetching daily tracking data:', error);
      dailyLogs = undefined;
      habitLogs = undefined;
    }

    // Generate AI summary with enhanced data including daily tracking
    const aiSummary = await generateCheckInSummary(
      currentCheckIn,
      previousCheckIns,
      clientName,
      dailyLogs,
      habitLogs,
      startDate,
      endDate
    );

    // Update check-in with AI summary for coach review
    await updateCheckInAISummary(
      checkInId,
      aiSummary.summary,
      aiSummary.insights,
      aiSummary.recommendations,
      aiSummary.responseDraft
    );
  } catch (error) {
    console.error(`Error in AI summary generation for check-in ${checkInId}:`, error);
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
  client: any,
  checkInData: SubmitCheckInRequest | CheckInFormData
): Promise<void> {
  try {
    const updates: any = {};

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
      if (bmr !== null) {
        // Calculate TDEE (sedentary = BMR × 1.2)
        const tdee = Math.round(bmr * 1.2);

        // Update BMR and TDEE directly in database
        const { error: updateError } = await supabaseAdmin
          .from("clients")
          .update({ bmr, tdee })
          .eq("id", client.id);

        if (updateError) {
          console.error("Error updating BMR/TDEE:", updateError);
        }
      }
    }
  } catch (error) {
    console.error("Error updating client metrics from check-in:", error);
    throw error;
  }
}