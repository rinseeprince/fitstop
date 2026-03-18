import { NextRequest, NextResponse } from "next/server";
import {
  getClientCheckIns,
  updateCheckInAISummary,
} from "@/services/check-in-service";
import { getClientById } from "@/services/client-service";
import { generateCheckInSummary, regenerateAISummary } from "@/services/ai-service";
import { getDailyLogs } from "@/services/daily-logs-service";
import { getHabitLogs } from "@/services/daily-habits-service";
import { getWeeklySummaries } from "@/services/weekly-nutrition-service";
import { calculateCheckInPeriod } from "@/lib/date-utils";
import type { GenerateAISummaryResponse } from "@/types/check-in";
import { aiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { requireCoachOwnsCheckIn } from "@/lib/require-coach-auth";
import { aiSummaryRequestSchema } from "@/lib/validations/check-in";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const { id: checkInId } = await params;

    // Verify coach owns this check-in's client
    const auth = await requireCoachOwnsCheckIn(checkInId);
    if (!auth.authorized) return auth.response;

    // Rate limit by coach account to prevent cost abuse across IPs
    const rateLimitResult = await aiRateLimit(request, auth.coachId);
    if (rateLimitResult) return rateLimitResult;
    const currentCheckIn = auth.checkIn;

    const body = await request.json();
    const parsed = aiSummaryRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request data" },
        { status: 400 }
      );
    }
    const { focus } = parsed.data;

    // Get client name for AI prompt
    const client = await getClientById(currentCheckIn.clientId);
    const clientName = client?.name ?? "Client";

    // Get previous check-ins for context
    const { checkIns } = await getClientCheckIns(currentCheckIn.clientId, {
      limit: 5,
    });
    const previousCheckIns = checkIns.filter((ci) => ci.id !== checkInId);

    // Calculate date range using fixed 7-day period based on expectedCheckInDay
    let startDate: Date;
    let endDate: Date;

    if (currentCheckIn.periodStart && currentCheckIn.periodEnd) {
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
      endDate = new Date(currentCheckIn.createdAt);
      startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 6);
    }

    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    // Fetch daily tracking context and weekly nutrition summary for the period
    let dailyLogs, habitLogs, weeklySummary;
    try {
      const [logs, habits, summaries] = await Promise.all([
        getDailyLogs(currentCheckIn.clientId, startDateStr, endDateStr),
        getHabitLogs(currentCheckIn.clientId, startDateStr, endDateStr),
        getWeeklySummaries(currentCheckIn.clientId, startDateStr, endDateStr),
      ]);
      dailyLogs = logs;
      habitLogs = habits;
      weeklySummary = summaries[0] ?? null;
    } catch (error) {
      // If daily tracking fetch fails, continue without it
      console.error('Error fetching daily tracking data:', error instanceof Error ? error.message : 'Unknown error');
      dailyLogs = undefined;
      habitLogs = undefined;
      weeklySummary = null;
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
          endDate,
          weeklySummary
        )
      : await generateCheckInSummary(
          currentCheckIn,
          previousCheckIns,
          clientName,
          dailyLogs,
          habitLogs,
          startDate,
          endDate,
          weeklySummary
        );

    // Update check-in with new AI summary (v2 format)
    await updateCheckInAISummary(checkInId, aiSummary);

    const response: GenerateAISummaryResponse = {
      success: true,
      summary: aiSummary,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("Error generating AI summary:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json(
      {
        success: false,
        error: "Failed to generate AI summary",
      },
      { status: 500 }
    );
  }
}
