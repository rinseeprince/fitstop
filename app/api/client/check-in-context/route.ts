import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import {
  getCheckInTrainingContext,
  getCheckInNutritionContext,
  getCheckInTrainingPeriodStats,
} from "@/services/check-in-context-service";
import { getClientById } from "@/services/client-service";
import { getDailyLogs } from "@/services/daily-logs-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { calculateCheckInPeriod, getCheckInStatus, formatDateISO } from "@/lib/date-helpers";
import type { CheckInGateStatus } from "@/lib/date-helpers";
import type { ValidateCheckInTokenResponse } from "@/types/check-in";

/**
 * GET /api/client/check-in-context
 *
 * Retrieves the check-in context for an authenticated client, including
 * client information, training context, and nutrition context needed
 * for the check-in form. Enforces check-in schedule gating.
 */
export async function GET(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    // Fetch client info
    const client = await getClientById(auth.clientId);

    if (!client) {
      return NextResponse.json(
        { success: false, error: "Client not found" },
        { status: 404 }
      );
    }

    // --- Fetch last check-in for gating + period calculation ---
    const expectedDay = client.expectedCheckInDay;
    let checkInGateStatus: CheckInGateStatus = "available";

    const supabase = await createServerSupabaseClient();
    const { data: lastCheckIn } = await supabase
      .from("check_ins")
      .select("period_end, created_at")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastCheckInPeriodEnd = lastCheckIn?.period_end
      ?? (lastCheckIn?.created_at
        ? new Date(lastCheckIn.created_at).toISOString().split("T")[0]
        : null);

    const isFirstCheckIn = !lastCheckIn;

    if (expectedDay) {
      const today = new Date();
      const { status, nextDueDate } = getCheckInStatus(
        expectedDay,
        lastCheckInPeriodEnd,
        today
      );
      checkInGateStatus = status;

      if (status === "not_due") {
        return NextResponse.json(
          {
            success: false,
            error: "not_due",
            message: `Your next check-in is due on ${nextDueDate}. Check back then!`,
            nextDueDate,
          },
          { status: 403 }
        );
      }

      if (status === "completed") {
        return NextResponse.json(
          {
            success: false,
            error: "completed",
            message: "You've already completed your check-in for this week. Great job!",
            nextDueDate,
          },
          { status: 403 }
        );
      }
    }

    // --- Calculate period ---
    // First check-in: start_date to today
    // Subsequent check-ins: 7-day window based on expected check-in day
    const today = new Date();
    let periodStart: string;
    let periodEnd: string;

    if (isFirstCheckIn && client.startDate) {
      periodStart = client.startDate;
      periodEnd = formatDateISO(today);
    } else if (expectedDay) {
      const period = calculateCheckInPeriod(today, expectedDay);
      periodStart = period.periodStart;
      periodEnd = period.periodEnd;
    } else {
      // Fallback for clients without an expected day: use last 7 days
      const startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 6);
      periodStart = formatDateISO(startDate);
      periodEnd = formatDateISO(today);
    }

    // Math.round avoids off-by-one when dates straddle a DST transition
    // (e.g. GMT→BST on Mar 29 steals 1 hour, making Math.floor short by 1 day)
    const periodDays = Math.round(
      (new Date(periodEnd + "T12:00:00").getTime() - new Date(periodStart + "T12:00:00").getTime())
      / 86_400_000
    ) + 1;

    // Fetch coach info, context in parallel
    // supabaseAdmin required: no client-facing SELECT RLS policy exists on coaches table
    const [coachResult, trainingContext, nutritionContext, trainingPeriodStats] = await Promise.all([
      supabaseAdmin
        .from("coaches")
        .select("name")
        .eq("id", client.coachId)
        .single(),
      getCheckInTrainingContext(client.id),
      getCheckInNutritionContext(client.id),
      getCheckInTrainingPeriodStats(client.id, periodStart, periodEnd),
    ]);

    const coach = coachResult.data;

    // Fetch daily logs for the calculated period
    const dailyLogs = await getDailyLogs(client.id, periodStart, periodEnd);

    const response: Omit<ValidateCheckInTokenResponse, "valid"> & {
      periodStart: string;
      periodEnd: string;
      periodDays: number;
      trainingPeriodStats: { sessionsCompleted: number; sessionsPlanned: number };
    } = {
      clientInfo: {
        id: client.id,
        name: client.name,
        email: client.email,
        coachName: coach?.name ?? "Your Coach",
        checkInFrequencyDays: 7,
      },
      trainingContext,
      nutritionContext,
      trainingPeriodStats,
      dailyLogs,
      periodStart,
      periodEnd,
      periodDays,
    };

    return NextResponse.json({ success: true, data: { ...response, checkInStatus: checkInGateStatus } });
  } catch (error) {
    console.error("Error fetching check-in context:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch context",
      },
      { status: 500 }
    );
  }
}
