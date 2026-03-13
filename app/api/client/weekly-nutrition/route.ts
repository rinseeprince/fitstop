import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { clientApiRateLimit } from "@/lib/rate-limit";
import { getWeeklySummaries, getLatestWeeklySummary, backfillWeeklySummariesForClient, upsertWeeklySummary } from "@/services/weekly-nutrition-service";
import { getWeekStart, getTodayDateString, getDateDaysAgo } from "@/lib/date-helpers";

export async function GET(request: NextRequest) {
  const rateLimitResult = await clientApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const clientId = await getAuthenticatedClientId();

    if (!clientId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const latest = searchParams.get("latest") === "true";

    if (latest) {
      // Read existing summary first; only calculate if none exists yet
      let summary = await getLatestWeeklySummary(clientId);
      if (!summary) {
        const currentWeekStart = getWeekStart(getTodayDateString());
        summary = await upsertWeeklySummary(clientId, currentWeekStart);
      }
      return NextResponse.json(
        { success: true, data: summary },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const startDate = searchParams.get("startDate") ?? undefined;
    const endDate = searchParams.get("endDate") ?? undefined;

    let summaries = await getWeeklySummaries(clientId, startDate, endDate);
    if (summaries.length === 0) {
      // Limit backfill to last 12 weeks to prevent unbounded computation
      const maxBackfillStart = getWeekStart(getDateDaysAgo(12 * 7));
      await backfillWeeklySummariesForClient(clientId, maxBackfillStart);
      summaries = await getWeeklySummaries(clientId, startDate, endDate);
    }

    return NextResponse.json(
      { success: true, data: summaries },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Error fetching weekly nutrition summaries:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json(
      { success: false, error: "Failed to fetch weekly nutrition summaries" },
      { status: 500 }
    );
  }
}
