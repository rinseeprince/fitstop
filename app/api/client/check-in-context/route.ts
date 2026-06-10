import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import {
  getCheckInTrainingContext,
  getCheckInNutritionContext,
  getCheckInTrainingPeriodStats,
  getTrainingEventDetailsForPeriod,
} from "@/services/check-in-context-service";
import { getClientById } from "@/services/client-service";
import { getDailyLogs } from "@/services/daily-logs-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getCheckInStatus, getDateString, getTodayInTimezone, resolveCheckInWindow } from "@/lib/date-helpers";
import type { CheckInGateStatus } from "@/lib/date-helpers";
import type { ValidateCheckInTokenResponse, CheckInTrainingEventDetail } from "@/types/check-in";

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
    // Client info + last check-in run in parallel: both key only on the
    // authenticated client id, and gating still short-circuits below before any
    // of the heavy context fan-out runs.
    const supabase = await createServerSupabaseClient();
    const [client, lastCheckInResult] = await Promise.all([
      getClientById(auth.clientId),
      supabase
        .from("check_ins")
        .select("period_end, created_at")
        .eq("client_id", auth.clientId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (!client) {
      return NextResponse.json(
        { success: false, error: "Client not found" },
        { status: 404 }
      );
    }

    // --- Gating + period calculation ---
    const expectedDay = client.expectedCheckInDay;
    let checkInGateStatus: CheckInGateStatus = "available";

    const lastCheckIn = lastCheckInResult.data;

    const lastCheckInPeriodEnd = lastCheckIn?.period_end
      ?? (lastCheckIn?.created_at
        ? getDateString(new Date(lastCheckIn.created_at))
        : null);

    if (expectedDay) {
      // Client-local today: the check-in window opens/rolls on the CLIENT's
      // day, not the server's UTC day.
      const today = getTodayInTimezone(client.timezone);
      const { status, nextDueDate } = getCheckInStatus(
        expectedDay,
        lastCheckInPeriodEnd,
        today,
        client.startDate
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
    // The check-in covers the fixed 7-day window ending on the client's check-in
    // day, clamped forward to their activation date for a partial first week (a
    // mid-week-activated client sees [start_date .. check-in day], not a full 7).
    // Shared with submitCheckIn so the displayed and stored periods agree.
    const today = getTodayInTimezone(client.timezone);
    const { periodStart, periodEnd } = resolveCheckInWindow(today, expectedDay, client.startDate);

    // Math.round avoids off-by-one when dates straddle a DST transition
    // (e.g. GMT→BST on Mar 29 steals 1 hour, making Math.floor short by 1 day)
    const periodDays = Math.round(
      (new Date(periodEnd + "T12:00:00").getTime() - new Date(periodStart + "T12:00:00").getTime())
      / 86_400_000
    ) + 1;

    // Coach info, context, and daily logs in parallel — all depend only on the
    // client and the already-computed period, so daily logs no longer needs its own
    // serial round-trip. (Runs only after gating, so a gated request never reaches
    // getCheckInNutritionContext and its plan-promotion side effect.)
    // supabaseAdmin required: no client-facing SELECT RLS policy exists on coaches table
    const [coachResult, trainingContext, nutritionContext, trainingPeriodStats, dailyLogs, trainingEventDetails] = await Promise.all([
      supabaseAdmin
        .from("coaches")
        .select("name")
        .eq("id", client.coachId)
        .single(),
      getCheckInTrainingContext(client.id),
      getCheckInNutritionContext(client.id),
      getCheckInTrainingPeriodStats(client.id, periodStart, periodEnd),
      getDailyLogs(client.id, periodStart, periodEnd),
      getTrainingEventDetailsForPeriod(client.id, periodStart, periodEnd),
    ]);

    const coach = coachResult.data;

    const response: Omit<ValidateCheckInTokenResponse, "valid"> & {
      periodStart: string;
      periodEnd: string;
      periodDays: number;
      trainingPeriodStats: { sessionsCompleted: number; sessionsPlanned: number };
      // Additive (Session 6.2): per-event training detail, single-sourced from
      // training_events. Optional so existing RN clients stay back-compatible.
      trainingEventDetails?: CheckInTrainingEventDetail[];
    } = {
      clientInfo: {
        id: client.id,
        name: client.name,
        email: client.email,
        coachName: coach?.name ?? "Your Coach",
        checkInFrequencyDays: 7,
        // Session 6.4: needed client-side so canEditDay computes "today" in the
        // client's IANA zone for the editable/locked training rows.
        timezone: client.timezone,
      },
      trainingContext,
      nutritionContext,
      trainingPeriodStats,
      dailyLogs,
      trainingEventDetails,
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
