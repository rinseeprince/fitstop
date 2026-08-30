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
import { checkInWeekday } from "@/lib/check-in-week";
import { getCheckInGate } from "@/lib/check-in-schedule";
import { getTodayInTimezone, resolveCheckInWindow } from "@/lib/date-helpers";
import { getClientCheckInForm } from "@/services/check-in-form-service";
import type { CheckInContextResponse } from "@/types/check-in";

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
    // The gate no longer reads the client's check-in history, so the paired
    // query that used to run here is gone. Gating still short-circuits below
    // before any of the heavy context fan-out runs.
    const client = await getClientById(auth.clientId);

    if (!client) {
      return NextResponse.json(
        { success: false, error: "Client not found" },
        { status: 404 }
      );
    }

    // --- Gating + period calculation ---
    // A pure read of the stored due date. `not_due` now covers what the retired
    // `completed` state used to say as well: submitting advances the date, so a
    // client who has already checked in and a client whose turn has not come
    // round yet are the same state — "nothing to do until <date>".
    const { status: checkInGateStatus, nextDueDate } = getCheckInGate(client);

    // No schedule, no check-in. There is no due date to report against and no
    // period for the submission to cover, so the form is refused outright
    // rather than opened over a window derived from nothing.
    if (checkInGateStatus === "unscheduled") {
      return NextResponse.json(
        {
          success: false,
          error: "unscheduled",
          message: "Your coach has not scheduled your check-ins yet.",
          nextDueDate: null,
        },
        { status: 403 }
      );
    }

    if (checkInGateStatus === "not_due") {
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

    // --- Calculate period ---
    // The check-in covers the fixed 7-day window ending on the client's check-in
    // day, clamped forward to their activation date for a partial first week (a
    // mid-week-activated client sees [start_date .. check-in day], not a full 7).
    // Shared with submitCheckIn so the displayed and stored periods agree.
    const today = getTodayInTimezone(client.timezone);
    // Unconditional: an unscheduled client was refused above, so by here there
    // is always a due date to take the weekday from.
    const { periodStart, periodEnd } = resolveCheckInWindow(
      today,
      checkInWeekday(client),
      client.startDate,
    );

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
    const [coachResult, trainingContext, nutritionContext, trainingPeriodStats, dailyLogs, trainingEventDetails, form] = await Promise.all([
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
      // The coach's per-client form (C6a). Joined to the existing fan-out, so
      // it costs no extra round trip. Always resolved: a client with no form
      // row gets all 14 field keys and no questions, which is exactly what
      // every client got before this key existed.
      getClientCheckInForm(client.id),
    ]);

    const coach = coachResult.data;

    // CheckInContextResponse describes the WHOLE payload — it is the RN
    // contract (ARCHITECTURE -> "The React Native contract"), and it used to
    // describe five of eleven keys while a local intersection here added the
    // rest. A payload key with no type is how the wire and the doc drift apart.
    const response: CheckInContextResponse = {
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
      form,
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
