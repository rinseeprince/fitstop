import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { getClientTodayString } from "@/services/today-service";
import { getActiveNutritionPlanId } from "@/services/nutrition-plan-service";
import { resetNutritionEvent } from "@/services/nutrition-event-edit-service";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * PATCH - Reset a coach-edited day back to auto: clear `is_modified` and
 * regenerate that date from the plan. Today-forward only.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; date: string }> }
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

    const { id: clientId, date } = await params;
    if (!DATE_RE.test(date)) {
      return NextResponse.json(
        { success: false, error: "Invalid date (expected YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    const client = await getClientById(clientId);
    if (!client || client.coachId !== coachId) {
      return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 });
    }

    // Today-forward guard: the is_modified flip itself mutates the row, so a
    // past date must be rejected before it (not just relying on the regen).
    const clientToday = await getClientTodayString(clientId);
    if (date < clientToday) {
      return NextResponse.json(
        { success: false, error: "Cannot reset past dates" },
        { status: 403 }
      );
    }

    const activePlanId = await getActiveNutritionPlanId(clientId);
    if (!activePlanId) {
      return NextResponse.json(
        { success: false, error: "No active nutrition plan" },
        { status: 404 }
      );
    }

    await resetNutritionEvent(clientId, date, activePlanId);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error(
      "Error resetting nutrition day:",
      error instanceof Error ? error.message : "Unknown error"
    );
    return NextResponse.json(
      { success: false, error: "Failed to reset nutrition day" },
      { status: 500 }
    );
  }
}
