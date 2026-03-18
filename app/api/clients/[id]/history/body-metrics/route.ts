import { NextRequest, NextResponse } from "next/server";
import { parsePaginationParams } from "@/lib/api-utils";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { supabaseAdmin } from "@/services/supabase-admin";

const BODY_METRICS_COLUMNS = `
  created_at,
  period_start,
  period_end,
  weight,
  weight_unit,
  body_fat_percentage,
  waist,
  hips,
  chest,
  arms,
  thighs,
  measurement_unit
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
    const { data, error, count } = await supabaseAdmin
      .from("check_ins")
      .select(BODY_METRICS_COLUMNS, { count: "exact" })
      .eq("client_id", clientId)
      .or("weight.not.is.null,body_fat_percentage.not.is.null")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("Error fetching body metrics history:", error);
      return NextResponse.json(
        { error: "Failed to fetch body metrics history" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { rows: data || [], total: count || 0 },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching body metrics history:", error);
    return NextResponse.json(
      { error: "Failed to fetch body metrics history" },
      { status: 500 }
    );
  }
}
