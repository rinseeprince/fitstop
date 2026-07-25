import { NextRequest, NextResponse } from "next/server";
import { parsePaginationParams } from "@/lib/api-utils";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getCoachTodayString } from "@/services/today-service";
import type { WellnessHistoryRow } from "@/types/history";

const WELLNESS_COLUMNS = `
  date,
  mood,
  energy,
  sleep,
  stress,
  soreness
`.replace(/\s+/g, " ").trim();

function generateDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(start + "T00:00:00");
  const endDate = new Date(end + "T00:00:00");
  while (cursor <= endDate) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, "0");
    const d = String(cursor.getDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${d}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id: clientId } = await params;

    const auth = await requireCoachOwnsClient(clientId);
    if (!auth.authorized) return auth.response;

    const { searchParams } = new URL(request.url);
    const pagination = parsePaginationParams(searchParams);
    if (!pagination.valid) {
      return NextResponse.json(
        { success: false, error: pagination.error },
        { status: 400 }
      );
    }

    const { limit, offset } = pagination;

    // Coach-local today bounds the history range in BOTH paths (coach's
    // view) — a client a day ahead of the coach has rows that are still
    // "tomorrow" from the coach's seat.
    const today = await getCoachTodayString(auth.coachId);

    // Check for active phase
    // Uses supabaseAdmin: coach querying client data (RLS exception 2)
    const { data: phase } = await supabaseAdmin
      .from("phases")
      .select("start_date")
      .eq("client_id", clientId)
      .eq("status", "active")
      .maybeSingle();

    const phaseStartDate = phase?.start_date as string | null;

    if (phaseStartDate) {
      const dates = generateDateRange(phaseStartDate, today);
      const total = dates.length;

      // Fetch wellness logs for the full range
      // Uses supabaseAdmin: coach querying client data (RLS exception 3)
      const { data: wellnessLogs, error: wellnessError } = await supabaseAdmin
        .from("wellness_logs")
        .select(WELLNESS_COLUMNS)
        .eq("client_id", clientId)
        .gte("date", phaseStartDate)
        .lte("date", today) as unknown as {
          data: Array<{ date: string; mood: number | null; energy: number | null; sleep: number | null; stress: number | null; soreness: number | null }> | null;
          error: { message: string } | null;
        };

      if (wellnessError) {
        console.error("Error fetching wellness logs:", wellnessError);
        return NextResponse.json(
          { error: "Failed to fetch wellness history" },
          { status: 500 }
        );
      }

      // Build lookup of logged days
      const logsByDate = new Map<string, { mood: number | null; energy: number | null; sleep: number | null; stress: number | null; soreness: number | null }>();
      for (const log of wellnessLogs || []) {
        logsByDate.set(log.date, log);
      }

      // Generate full date range with gap-filling
      const allRows: WellnessHistoryRow[] = dates.map((date) => {
        const log = logsByDate.get(date);
        if (log) {
          return { date, mood: log.mood, energy: log.energy, sleep: log.sleep, stress: log.stress, soreness: log.soreness, is_logged: true };
        }
        return { date, mood: null, energy: null, sleep: null, stress: null, soreness: null, is_logged: false };
      });

      // Reverse for newest-first, then paginate
      allRows.reverse();
      const paged = allRows.slice(offset, offset + limit);

      return NextResponse.json({ rows: paged, total }, { status: 200 });
    }

    // Fallback: no active phase, use existing logged-only behavior
    // Uses supabaseAdmin: coach querying client data (RLS exception 3)
    const { data, error, count } = await supabaseAdmin
      .from("wellness_logs")
      .select(WELLNESS_COLUMNS, { count: "exact" })
      .eq("client_id", clientId)
      .lte("date", today)
      .or("mood.not.is.null,energy.not.is.null,sleep.not.is.null,stress.not.is.null,soreness.not.is.null")
      .order("date", { ascending: false })
      .range(offset, offset + limit - 1) as unknown as { data: unknown[] | null; error: { message: string } | null; count: number | null };

    if (error) {
      console.error("Error fetching wellness history:", error);
      return NextResponse.json(
        { error: "Failed to fetch wellness history" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { rows: data || [], total: count || 0 },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching wellness history:", error);
    return NextResponse.json(
      { error: "Failed to fetch wellness history" },
      { status: 500 }
    );
  }
}
