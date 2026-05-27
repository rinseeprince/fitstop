import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { isValidDateParam, nutritionCardSchema } from "@/lib/validations/daily-log-cards";
import {
  getNutritionForDate,
  resolvePlanContextForDate,
  assertHasActivePlan,
  NoActivePlanError,
} from "@/services/daily-context-service";
import { getDayEditState, assertCanEdit } from "@/services/daily-log-permissions-service";
import { upsertNutritionLog } from "@/services/daily-log-card-service";
import { DayLockedError } from "@/lib/daily-log-permissions";

/**
 * GET nutrition for a date: consumed + target via the three-level priority
 * (log snapshot → event → null), plus `editable` for the UI lock state.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  const { date } = await params;
  if (!isValidDateParam(date)) {
    return NextResponse.json(
      { success: false, error: "Invalid date format. Use YYYY-MM-DD" },
      { status: 400 }
    );
  }

  try {
    const [nutrition, editState] = await Promise.all([
      getNutritionForDate(auth.clientId, date),
      getDayEditState(auth.clientId, date, "nutrition"),
    ]);
    return NextResponse.json(
      { success: true, data: { ...nutrition, editable: editState.editable } },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Error fetching nutrition for date:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch nutrition" },
      { status: 500 }
    );
  }
}

/**
 * PATCH nutrition (kcal + macros). Guards the date-edit rule via assertCanEdit (403 when
 * locked), resolves plan context, then writes nutrition_logs. Targets are server-resolved.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  const { date } = await params;
  if (!isValidDateParam(date)) {
    return NextResponse.json(
      { success: false, error: "Invalid date format. Use YYYY-MM-DD" },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => null);
  const result = nutritionCardSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { success: false, error: "Invalid input data" },
      { status: 400 }
    );
  }

  try {
    const { loggedStatus } = await assertCanEdit({
      clientId: auth.clientId,
      date,
      resourceType: "nutrition",
    });
    const ctx = await resolvePlanContextForDate(auth.clientId, date);
    assertHasActivePlan(ctx, "nutrition");
    const dailyLog = await upsertNutritionLog(auth.clientId, date, result.data, {
      phaseId: ctx.phaseId,
      nutritionPlanId: ctx.nutritionPlanId,
    });
    return NextResponse.json(
      { success: true, data: dailyLog },
      { status: loggedStatus === "logged" ? 200 : 201 }
    );
  } catch (error) {
    if (error instanceof DayLockedError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 403 }
      );
    }
    if (error instanceof NoActivePlanError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 422 }
      );
    }
    console.error("Error saving nutrition log:", error);
    return NextResponse.json(
      { success: false, error: "Failed to save nutrition log" },
      { status: 500 }
    );
  }
}
