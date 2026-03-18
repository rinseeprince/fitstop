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

    // Last 7 calendar days (today inclusive)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const sinceDate = sevenDaysAgo.toISOString().split("T")[0];

    // Uses supabaseAdmin: coach querying client data (RLS exception 3)
    const { data, error } = await supabaseAdmin
      .from("daily_logs")
      .select("mood, energy, sleep, stress")
      .eq("client_id", clientId)
      .or("mood.not.is.null,energy.not.is.null,sleep.not.is.null,stress.not.is.null")
      .gte("date", sinceDate);

    if (error) {
      console.error("Error fetching wellness summary:", error);
      return NextResponse.json(
        { error: "Failed to fetch wellness summary" },
        { status: 500 }
      );
    }

    const rows = data || [];

    // Average per-metric over only the rows where that metric is non-null
    function avgMetric(field: "mood" | "energy" | "sleep" | "stress"): number | null {
      const values = rows.filter((r) => r[field] != null).map((r) => r[field] as number);
      if (values.length === 0) return null;
      const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
      return Math.round(avg * 10) / 10;
    }

    const summary = {
      avg_mood: avgMetric("mood"),
      avg_energy: avgMetric("energy"),
      avg_sleep: avgMetric("sleep"),
      avg_stress: avgMetric("stress"),
      days_logged: rows.length,
    };

    return NextResponse.json(summary, { status: 200 });
  } catch (error) {
    console.error("Error fetching wellness summary:", error);
    return NextResponse.json(
      { error: "Failed to fetch wellness summary" },
      { status: 500 }
    );
  }
}
