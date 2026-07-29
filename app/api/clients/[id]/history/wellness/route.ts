import { NextRequest, NextResponse } from "next/server";
import { parsePaginationParams } from "@/lib/api-utils";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getCoachTodayString } from "@/services/today-service";

const WELLNESS_COLUMNS = `
  date,
  mood,
  energy,
  sleep,
  stress,
  soreness
`.replace(/\s+/g, " ").trim();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id: clientId } = await params;

    const auth = await requireCoachOwnsClient(clientId, request);
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

    // Coach-local today bounds the history range (coach's view) — a client a
    // day ahead of the coach has rows that are still "tomorrow" from the
    // coach's seat.
    const today = await getCoachTodayString(auth.coachId);

    // Logged-only rows, newest first
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
