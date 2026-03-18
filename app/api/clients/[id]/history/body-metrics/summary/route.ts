import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
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

    // Uses supabaseAdmin: coach querying client data (RLS exception 3)
    const { data, error } = await supabaseAdmin
      .from("check_ins")
      .select("weight, weight_unit")
      .eq("client_id", clientId)
      .not("weight", "is", null)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      console.error("Error fetching body metrics summary:", error);
      return NextResponse.json(
        { error: "Failed to fetch body metrics summary" },
        { status: 500 }
      );
    }

    const latest = data?.[0] ?? null;

    const summary = {
      current_weight: latest?.weight ?? null,
      weight_unit: latest?.weight_unit ?? null,
    };

    return NextResponse.json(summary, { status: 200 });
  } catch (error) {
    console.error("Error fetching body metrics summary:", error);
    return NextResponse.json(
      { error: "Failed to fetch body metrics summary" },
      { status: 500 }
    );
  }
}
