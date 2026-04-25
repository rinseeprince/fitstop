import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getTodayDateString } from "@/lib/date-helpers";
// Uses supabaseAdmin: coach-side cross-table query spanning phases and check_ins
import { supabaseAdmin } from "@/services/supabase-admin";
import type { PhaseWeeklyDataRow } from "@/types/roadmap";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; phaseId: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id: clientId, phaseId } = await params;

    const auth = await requireCoachOwnsClient(clientId);
    if (!auth.authorized) return auth.response;

    const { data: phase, error: phaseError } = await supabaseAdmin
      .from("phases")
      .select("start_date, end_date")
      .eq("id", phaseId)
      .eq("client_id", clientId)
      .maybeSingle();

    if (phaseError) {
      console.error("Error fetching phase for weekly data:", phaseError);
      throw new Error("Failed to fetch phase");
    }

    let weeklyData: PhaseWeeklyDataRow[] = [];
    if (phase && phase.start_date) {
      const endDate = phase.end_date ?? getTodayDateString();

      const { data: checkIns, error: checkInsError } = await supabaseAdmin
        .from("check_ins")
        .select(
          "weight, nutrition_days_on_target, workouts_completed, period_start, period_end, created_at"
        )
        .eq("client_id", clientId)
        .gte("period_start", phase.start_date)
        .lte("period_end", endDate)
        .order("period_start", { ascending: true });

      if (checkInsError) {
        console.error("Error fetching check-ins for weekly data:", checkInsError);
        throw new Error("Failed to fetch check-in data");
      }

      weeklyData = (checkIns ?? [])
        .filter((row) => row.period_start && row.period_end && row.created_at)
        .map((row, index) => ({
          weekNumber: index + 1,
          periodStart: row.period_start!,
          periodEnd: row.period_end!,
          checkInDate: row.created_at!,
          weight: row.weight != null ? Number(row.weight) : null,
          nutritionDaysOnTarget:
            row.nutrition_days_on_target != null
              ? Number(row.nutrition_days_on_target)
              : null,
          trainingSessions: row.workouts_completed ?? 0,
        }));
    }

    return NextResponse.json(
      { success: true, data: weeklyData },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching phase weekly data:", error);
    return NextResponse.json(
      { error: "Failed to fetch weekly data" },
      { status: 500 }
    );
  }
}
