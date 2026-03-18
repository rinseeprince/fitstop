import { NextRequest, NextResponse } from "next/server";
import { parsePaginationParams } from "@/lib/api-utils";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { supabaseAdmin } from "@/services/supabase-admin";

const NUTRITION_COLUMNS = `
  date,
  calories_consumed,
  target_calories,
  protein_g,
  target_protein_g,
  carbs_g,
  target_carbs_g,
  fat_g,
  target_fat_g,
  calorie_surplus_deficit,
  nutrition_adherence
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
      .from("daily_logs")
      .select(NUTRITION_COLUMNS, { count: "exact" })
      .eq("client_id", clientId)
      .not("calories_consumed", "is", null)
      .order("date", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("Error fetching nutrition history:", error);
      return NextResponse.json(
        { error: "Failed to fetch nutrition history" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { rows: data || [], total: count || 0 },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching nutrition history:", error);
    return NextResponse.json(
      { error: "Failed to fetch nutrition history" },
      { status: 500 }
    );
  }
}
