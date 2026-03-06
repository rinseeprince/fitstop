import { NextRequest, NextResponse } from "next/server";
import {
  getClientCheckIns,
  updateCheckInAISummary,
} from "@/services/check-in-service";
import { getClientById } from "@/services/client-service";
import { generateCheckInSummary, regenerateAISummary } from "@/services/ai-service";
import { getDailyLogs } from "@/services/daily-logs-service";
import { getHabitLogs } from "@/services/daily-habits-service";
import type { GenerateAISummaryResponse } from "@/types/check-in";
import { rateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsCheckIn } from "@/lib/require-coach-auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Custom stricter rate limit for AI operations (10 requests per minute)
  const rateLimitResult = await rateLimit(request, {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 10, // 10 requests per minute
  });
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { id: checkInId } = await params;

    // Verify coach owns this check-in's client
    const auth = await requireCoachOwnsCheckIn(checkInId);
    if (!auth.authorized) return auth.response;
    const currentCheckIn = auth.checkIn;

    const body = await request.json();
    const focus = body.focus as "positive" | "detailed" | "concise" | undefined;

    // Get client name for AI prompt
    const client = await getClientById(currentCheckIn.clientId);
    const clientName = client?.name || "Client";

    // Get previous check-ins for context
    const { checkIns } = await getClientCheckIns(currentCheckIn.clientId, {
      limit: 5,
    });
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
        getDailyLogs(currentCheckIn.clientId, startDateStr, endDateStr),
        getHabitLogs(currentCheckIn.clientId, startDateStr, endDateStr),
      ]);
    } catch (error) {
      // If daily tracking fetch fails, continue without it
      console.error('Error fetching daily tracking data:', error);
      dailyLogs = undefined;
      habitLogs = undefined;
    }

    // Generate or regenerate AI summary
    const aiSummary = focus
      ? await regenerateAISummary(
          currentCheckIn,
          previousCheckIns,
          clientName,
          focus,
          dailyLogs,
          habitLogs,
          startDate,
          endDate
        )
      : await generateCheckInSummary(
          currentCheckIn,
          previousCheckIns,
          clientName,
          dailyLogs,
          habitLogs,
          startDate,
          endDate
        );

    // Update check-in with new AI summary
    await updateCheckInAISummary(
      checkInId,
      aiSummary.summary,
      aiSummary.insights,
      aiSummary.recommendations,
      aiSummary.responseDraft
    );

    const response: GenerateAISummaryResponse = {
      success: true,
      summary: aiSummary,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error generating AI summary:", error);
    return NextResponse.json(
      {
        success: false,
        errorMessage: "Failed to generate AI summary",
      },
      { status: 500 }
    );
  }
}
