import { NextRequest, NextResponse } from "next/server";
import { parsePaginationParams } from "@/lib/api-utils";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { supabaseAdmin } from "@/services/supabase-admin";

const WELLNESS_COLUMNS = `
  date,
  mood,
  energy,
  sleep,
  stress,
  notes
`.replace(/\s+/g, " ").trim();

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

    // Uses supabaseAdmin: coach querying client data (RLS exception 3)
    // Direct query on wellness_logs - no join needed
    const { data, error, count } = await supabaseAdmin
      .from("wellness_logs" as never)
      .select(WELLNESS_COLUMNS, { count: "exact" })
      .eq("client_id" as never, clientId as never)
      .or("mood.not.is.null,energy.not.is.null,sleep.not.is.null,stress.not.is.null" as never)
      .order("date" as never, { ascending: false })
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
