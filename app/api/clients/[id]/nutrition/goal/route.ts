import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachAuth } from "@/lib/require-coach-auth";
import { captureApiError } from "@/lib/error-handler";
import { getClientById } from "@/services/client-service";
import { getNutritionGoalForDay } from "@/services/nutrition-goal-service";
import { nutritionGoalDayQuerySchema } from "@/lib/validations/nutrition";

type Params = { params: Promise<{ id: string }> };

/**
 * The goal in force on one day and the calculator's inputs for it — the
 * nutrition drawer's Starts on day (docs/MEASUREMENT-LOG-PLAN.md §6 commit
 * 8d1). The save resolves the goal for its own start through the same
 * resolver, so what the drawer previews is what it saves.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id: clientId } = await params;

    const auth = await requireCoachAuth(request);
    if (!auth.authorized) return auth.response;

    // The client record is itself an input — its newest weight and its energy
    // pair — so ownership is proven on the row the calculator reads.
    const client = await getClientById(clientId);
    if (!client || client.coachId !== auth.coachId) {
      return NextResponse.json({ success: false, error: "Client not found" }, { status: 404 });
    }

    const validation = nutritionGoalDayQuerySchema.safeParse({
      date: request.nextUrl.searchParams.get("date"),
    });
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input", details: validation.error.errors },
        { status: 400 }
      );
    }

    const data = await getNutritionGoalForDay(clientId, client, validation.data.date);
    return NextResponse.json(
      { success: true, data },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    captureApiError(error, { action: "nutrition-goal-for-day" });
    return NextResponse.json(
      { success: false, error: "Failed to read the goal for that day" },
      { status: 500 }
    );
  }
}
