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

    // Generate AI summary with enhanced data
    const aiSummary = await generateCheckInSummary(
      currentCheckIn,
      previousCheckIns,
      clientName
    );

    // Update check-in with AI summary for coach review
    await updateCheckInAISummary(
      checkInId,
      aiSummary.summary,
      aiSummary.insights,
      aiSummary.recommendations,
      aiSummary.responseDraft
    );
    
    console.log(`AI summary generated successfully for check-in ${checkInId}`);
  } catch (error) {
    console.error(`Error in AI summary generation for check-in ${checkInId}:`, error);
    throw error;
  }
}