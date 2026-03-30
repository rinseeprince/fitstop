import { NextRequest, NextResponse } from "next/server";
import { parsePaginationParams } from "@/lib/api-utils";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getTrainingHistory } from "@/services/training-history-service";
import { supabaseAdmin } from "@/services/supabase-admin";

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

    // Fetch client's check-in day for correct training week boundaries
    // Uses supabaseAdmin: coach querying client data (RLS exception 2)
    const { data: clientRow } = await supabaseAdmin
      .from("clients")
      .select("expected_check_in_day")
      .eq("id", clientId)
      .single();

    const result = await getTrainingHistory(
      clientId,
      { limit, offset },
      clientRow?.expected_check_in_day
    );

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Error fetching training history:", error);
    return NextResponse.json(
      { error: "Failed to fetch training history" },
      { status: 500 }
    );
  }
}
