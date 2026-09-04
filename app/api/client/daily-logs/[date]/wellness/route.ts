import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import { isValidDateParam, wellnessCardSchema } from "@/lib/validations/daily-log-cards";
import { getTodayLog } from "@/services/daily-logs-service";
import { getDayEditState, assertCanEdit } from "@/services/daily-log-permissions-service";
import { upsertWellnessLog } from "@/services/daily-log-card-service";
import { DayLockedError } from "@/lib/daily-log-permissions";

/**
 * GET wellness for a date: mood/energy/sleep/stress/soreness (nulls if absent), plus `editable`.
 *
 * `loggedStatus` was removed with the logged-day lock it existed for (owner,
 * 2026-09-04): the day rule no longer asks whether a resource has a row, so the
 * field had no reader left, and keeping it truthful meant a child-table read on
 * every load of this screen.
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
    const [log, editState] = await Promise.all([
      getTodayLog(auth.clientId, date),
      getDayEditState(auth.clientId, date),
    ]);
    return NextResponse.json(
      {
        success: true,
        data: {
          mood: log?.mood ?? null,
          energy: log?.energy ?? null,
          sleep: log?.sleep ?? null,
          stress: log?.stress ?? null,
          soreness: log?.soreness ?? null,
          editable: editState.editable,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Error fetching wellness for date:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch wellness" },
      { status: 500 }
    );
  }
}

/**
 * PATCH wellness (mood/energy/sleep/stress/soreness). Guards the date-edit rule via assertCanEdit
 * (403 when locked), then writes wellness_logs (wellness is not plan-gated).
 *
 * Always 200 — see the nutrition route for why the 201 branch went (D24).
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
  const result = wellnessCardSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { success: false, error: "Invalid input data" },
      { status: 400 }
    );
  }

  try {
    await assertCanEdit({
      clientId: auth.clientId,
      date,
      resourceType: "wellness",
    });
    const dailyLog = await upsertWellnessLog(auth.clientId, date, result.data);
    return NextResponse.json({ success: true, data: dailyLog });
  } catch (error) {
    if (error instanceof DayLockedError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 403 }
      );
    }
    console.error("Error saving wellness log:", error);
    return NextResponse.json(
      { success: false, error: "Failed to save wellness log" },
      { status: 500 }
    );
  }
}
