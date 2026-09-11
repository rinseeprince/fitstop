import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { getClientTodayString } from "@/services/today-service";
import { nutritionResetDaysSchema } from "@/lib/validations/nutrition";
import { resetNutritionEventDays } from "@/services/nutrition-event-edit-service";
import { NutritionLogRerecordError } from "@/services/daily-log-card-service";

/**
 * PATCH - Reset a LIST of coach-edited days back to the plan in one call: the
 * edits are removed and the plan's own numbers answer again. Today-forward
 * only. A selected day that held no edit is simply not counted.
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

    const { reset } = await resetNutritionEventDays({
      clientId,
      dates: futureDates,
      clientToday,
    });

    return NextResponse.json({ success: true, reset }, { status: 200 });
  } catch (error) {
    // The reset landed; only today's log snapshot is behind (owner,
    // 2026-09-11). Say exactly that rather than "failed to reset".
    if (error instanceof NutritionLogRerecordError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
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
