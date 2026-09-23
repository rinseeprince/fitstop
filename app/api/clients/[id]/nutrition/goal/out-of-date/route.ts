import { NextRequest, NextResponse } from "next/server";
import { coachApiRateLimit } from "@/lib/rate-limit";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { captureApiError } from "@/lib/error-handler";
import { getNutritionOutOfDate } from "@/services/nutrition-goal-service";

type Params = { params: Promise<{ id: string }> };

/**
 * Whether the client's nutrition still fits their goal: the earliest day,
 * today onward, a saved version's goal is not the one it was built for, or
 * null (docs/MEASUREMENT-LOG-PLAN.md §6 commit 8d1). The Overview's nutrition
 * card, the Nutrition tab and the drawer all show this one answer.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { id: clientId } = await params;

    const auth = await requireCoachOwnsClient(clientId, request);
    if (!auth.authorized) return auth.response;

    const data = await getNutritionOutOfDate(clientId);
    return NextResponse.json(
      { success: true, data },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    captureApiError(error, { action: "nutrition-out-of-date" });
    return NextResponse.json(
      { success: false, error: "Failed to check the nutrition targets against the goal" },
      { status: 500 }
    );
  }
}
