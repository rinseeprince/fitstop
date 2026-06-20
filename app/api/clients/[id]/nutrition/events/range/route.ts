import { NextRequest, NextResponse } from "next/server";
import { getClientById } from "@/services/client-service";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { getClientTodayString } from "@/services/today-service";
import { nutritionRangeEditSchema } from "@/lib/validations/nutrition";
import {
  materializeNutritionEventDays,
  type RangeEdit,
} from "@/services/nutrition-event-edit-service";

/**
 * PATCH - Materialize a coach edit (absolute or %/amount delta) onto every
 * future scheduled nutrition event in a date range. Today-forward only.
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
    const validation = nutritionRangeEditSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input", details: validation.error.issues },
        { status: 400 }
      );
    }
    const data = validation.data;

    // Per-element today-forward guard (no existing one to inherit): drop any
    // past dates and reject only if NONE survive. A scattered selection that
    // mixes past and future days still edits its future days.
    const clientToday = await getClientTodayString(clientId);
    const futureDates = data.dates.filter((d) => d >= clientToday);
    if (futureDates.length === 0) {
      return NextResponse.json(
        { success: false, error: "Cannot edit past dates" },
        { status: 403 }
      );
    }

    let edit: RangeEdit;
    if (data.mode === "absolute") {
      if (data.calories == null) {
        return NextResponse.json(
          { success: false, error: "absolute mode requires a calories value" },
          { status: 400 }
        );
      }
      edit = {
        mode: "absolute",
        calories: data.calories,
        proteinG: data.proteinG,
        carbG: data.carbG,
        fatG: data.fatG,
        note: data.note,
      };
    } else {
      edit = { mode: "delta", percent: data.percent, calorieDelta: data.calorieDelta, note: data.note };
    }

    const { updated } = await materializeNutritionEventDays(
      clientId,
      futureDates,
      edit,
      clientToday
    );

    return NextResponse.json({ success: true, updated }, { status: 200 });
  } catch (error) {
    console.error(
      "Error editing nutrition range:",
      error instanceof Error ? error.message : "Unknown error"
    );
    return NextResponse.json(
      { success: false, error: "Failed to edit nutrition range" },
      { status: 500 }
    );
  }
}
