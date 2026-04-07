import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { supabaseAdmin } from "@/services/supabase-admin";
import { getActiveTrainingPlan } from "@/services/training-service";
import { countPlannedSessions } from "@/utils/training-week-helpers";

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
    const start = searchParams.get("start");
    const end = searchParams.get("end");

    if (!start || !end) {
      return NextResponse.json(
        { success: false, error: "start and end query params are required" },
        { status: 400 }
      );
    }

    // Count completed sessions in the period
    // completed_at is TIMESTAMPTZ, so use time boundaries to include full days
    // Uses supabaseAdmin: coach querying client data (RLS exception 2)
    const { count, error } = await supabaseAdmin
      .from("session_logs")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("completion_quality", "full")
      .gte("completed_at", start + "T00:00:00")
      .lte("completed_at", end + "T23:59:59");

    if (error) {
      console.error("Error fetching training period stats:", error);
      return NextResponse.json(
        { success: false, error: "Failed to fetch training period stats" },
        { status: 500 }
      );
    }

    const sessionsCompleted = count ?? 0;

    // Count planned sessions from active training plan
    const plan = await getActiveTrainingPlan(clientId);
    let sessionsPlanned = 0;
    if (plan) {
      const sessions = plan.sessions.map((s) => ({
        dayOfWeek: s.dayOfWeek,
        sessionType: s.sessionType,
      }));
      sessionsPlanned = countPlannedSessions(sessions, start, end);
    }

    return NextResponse.json(
      { success: true, data: { sessionsCompleted, sessionsPlanned } },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching training period stats:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch training period stats" },
      { status: 500 }
    );
  }
}
