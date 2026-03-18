import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import {
  getCheckInTrainingContext,
  getCheckInNutritionContext,
} from "@/services/check-in-context-service";
import { getClientById } from "@/services/client-service";
import { getDailyLogs } from "@/services/daily-logs-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { clientApiRateLimit } from "@/lib/rate-limit";
import { calculateCheckInPeriod, getCheckInStatus, formatDateISO } from "@/lib/date-utils";
import type { CheckInGateStatus } from "@/lib/date-utils";
import type { ValidateCheckInTokenResponse } from "@/types/check-in";

/**
 * GET /api/client/check-in-context
 *
 * Retrieves the check-in context for an authenticated client, including
 * client information, training context, and nutrition context needed
 * for the check-in form. Enforces check-in schedule gating.
 */
export async function GET(request: NextRequest) {
  const rateLimitResult = await clientApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const clientId = await getAuthenticatedClientId();

    if (!clientId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Fetch client info
    const client = await getClientById(clientId);

    if (!client) {
      return NextResponse.json(
        { success: false, error: "Client not found" },
        { status: 404 }
      );
    }

    // --- Access gating based on check-in schedule ---
    const expectedDay = client.expectedCheckInDay;
    let checkInGateStatus: CheckInGateStatus = "available";

    if (expectedDay) {
      // Get the most recent check-in date for gating (uses server client with RLS)
      const supabase = await createServerSupabaseClient();
      const { data: lastCheckIn } = await supabase
        .from("check_ins")
        .select("period_end, created_at")
        .eq("client_id", client.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Use period_end (the period the check-in covers) instead of created_at
      // (when it was submitted). Fallback to created_at for pre-migration rows.
      const lastCheckInPeriodEnd = lastCheckIn?.period_end
        ?? (lastCheckIn?.created_at
          ? new Date(lastCheckIn.created_at).toISOString().split("T")[0]
          : null);

      const today = new Date();
      const { status, periodStart, periodEnd, nextDueDate } = getCheckInStatus(
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

    // --- Calculate period using fixed 7-day window ---
    const today = new Date();
    let periodStart: string;
    let periodEnd: string;

    if (expectedDay) {
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

    // Fetch coach info, context in parallel
    // supabaseAdmin required: no client-facing SELECT RLS policy exists on coaches table
    const [coachResult, trainingContext, nutritionContext] = await Promise.all([
      supabaseAdmin
        .from("coaches")
        .select("name")
        .eq("id", client.coachId)
        .single(),
      getCheckInTrainingContext(client.id),
      getCheckInNutritionContext(client.id),
    ]);

    const coach = coachResult.data;

    // Fetch daily logs for the calculated period
    const dailyLogs = await getDailyLogs(client.id, periodStart, periodEnd);

    const response: Omit<ValidateCheckInTokenResponse, "valid"> & {
      periodStart: string;
      periodEnd: string;
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
      dailyLogs,
      periodStart,
      periodEnd,
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
