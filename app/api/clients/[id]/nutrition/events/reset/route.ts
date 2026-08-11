import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { getClientTodayString } from "@/services/today-service";
import {
  getActiveNutritionPlanVersionsOverlapping,
  versionCoversDate,
} from "@/services/nutrition-plan-service";
import { nutritionResetDaysSchema } from "@/lib/validations/nutrition";
import { resetNutritionEventDays } from "@/services/nutrition-event-edit-service";

/**
 * PATCH - Reset a LIST of coach-edited days back to auto in one call: clear
 * `is_modified` and regenerate them from the plan. Today-forward only.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const coachId = await getAuthenticatedCoachId(request);
    if (!coachId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId } = await params;
    const client = await getClientById(clientId);
    if (!client || client.coachId !== coachId) {
      return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 });
    }

    const body = await request.json();
    const validation = nutritionResetDaysSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input", details: validation.error.issues },
        { status: 400 }
      );
    }

    // Per-element today-forward guard: drop past dates, reject only if none remain.
    const clientToday = await getClientTodayString(clientId);
    const futureDates = validation.data.dates.filter((d) => d >= clientToday);
    if (futureDates.length === 0) {
      return NextResponse.json(
        { success: false, error: "Cannot reset past dates" },
        { status: 403 }
      );
    }

    // Versioned model (migration 144): a date list can straddle an era
    // boundary, and each date must regenerate from the version COVERING it —
    // group the dates per covering version and reset group by group. Dates no
    // version covers are skipped (there is no prescription to reset them to).
    const sortedDates = [...futureDates].sort();
    const versions = await getActiveNutritionPlanVersionsOverlapping(
      clientId,
      sortedDates[0],
      sortedDates[sortedDates.length - 1]
    );
    const groups = new Map<string, string[]>();
    for (const date of sortedDates) {
      const covering = versions.find((v) => versionCoversDate(v, date));
      if (!covering) continue;
      const group = groups.get(covering.id);
      if (group) group.push(date);
      else groups.set(covering.id, [date]);
    }
    if (groups.size === 0) {
      return NextResponse.json(
        { success: false, error: "No nutrition plan covers the selected dates" },
        { status: 404 }
      );
    }

    let reset = 0;
    for (const [versionId, dates] of groups) {
      const result = await resetNutritionEventDays(clientId, dates, versionId, clientToday);
      reset += result.reset;
    }

    return NextResponse.json({ success: true, reset }, { status: 200 });
  } catch (error) {
    console.error(
      "Error resetting nutrition days:",
      error instanceof Error ? error.message : "Unknown error"
    );
    return NextResponse.json(
      { success: false, error: "Failed to reset nutrition days" },
      { status: 500 }
    );
  }
}
