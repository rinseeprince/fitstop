import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { getClientById } from "@/services/client-service";
import { getWeeklySummaries, getLatestWeeklySummary, upsertWeeklySummary } from "@/services/weekly-nutrition-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getWeekStart, getDateDaysAgo } from "@/lib/date-helpers";
import { getCoachTodayString } from "@/services/today-service";

const MAX_BACKFILL_WEEKS = 12;

async function backfillWeeklySummariesForClient(
  clientId: string,
  earliestWeekStart?: string
): Promise<void> {
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

  const weekStarts = new Set<string>();
  for (const row of logDates) {
    weekStarts.add(getWeekStart(row.date));
  }

  const { data: existing } = await supabaseAdmin
    .from("nutrition_weekly_summaries")
    .select("week_start_date")
    .eq("client_id", clientId);

  const existingWeeks = new Set((existing ?? []).map((r) => r.week_start_date));
  const missing = [...weekStarts].filter((ws) => !existingWeeks.has(ws)).slice(0, MAX_BACKFILL_WEEKS);

  await Promise.all(
    missing.map((weekStart) =>
      upsertWeeklySummary(clientId, weekStart).catch((err) => {
        console.error(`Backfill failed for week ${weekStart}:`, err instanceof Error ? err.message : "Unknown error");
      })
    )
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id: clientId } = await params;
    const coachId = await getAuthenticatedCoachId();

    if (!coachId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const client = await getClientById(clientId);
    if (!client || client.coachId !== coachId) {
      return NextResponse.json(
        { success: false, error: "Client not found or access denied" },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(request.url);
    const latest = searchParams.get("latest") === "true";

    if (latest) {
      // Read existing summary first; only calculate if none exists yet
      let summary = await getLatestWeeklySummary(clientId);
      if (!summary) {
        // Coach-local current week (this is the coach's metrics view).
        const currentWeekStart = getWeekStart(await getCoachTodayString(coachId));
        summary = await upsertWeeklySummary(clientId, currentWeekStart);
      }
      return NextResponse.json({ success: true, data: summary });
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

    return NextResponse.json({ success: true, data: summaries });
  } catch (error) {
    console.error("Error fetching weekly nutrition summaries:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json(
      { success: false, error: "Failed to fetch weekly nutrition summaries" },
      { status: 500 }
    );
  }
}
