import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCoachId } from "@/lib/auth-helpers";
import { getClientById } from "@/services/client-service";
import { getActiveTrainingPlan } from "@/services/training-service";
import { getClientHabits } from "@/services/daily-habits-service";
import {
  getNutritionPlanIdForDate,
  getNextFutureNutritionPlan,
} from "@/services/nutrition-plan-service";
import { getClientTodayString } from "@/services/today-service";
import { coachApiRateLimit } from "@/lib/rate-limit";

async function safeQuery<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    console.error("Activation readiness query failed:", error instanceof Error ? error.message : "Unknown error");
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResult = await coachApiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const coachId = await getAuthenticatedCoachId();
    if (!coachId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id: clientId } = await params;
    const client = await getClientById(clientId, true);
    if (!client) {
      return NextResponse.json({ success: false, error: "Client not found" }, { status: 404 });
    }
    if (client.coachId !== coachId) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const [trainingPlan, habits, hasNutritionPlan] = await Promise.all([
      safeQuery(() => getActiveTrainingPlan(clientId)),
      safeQuery(() => getClientHabits(clientId)),
      // Versioned model (migration 144): ready = a version covers the client's
      // today OR one is queued — a coach who queued a first plan IS set up.
      // The same covering-or-future predicate as the client log guard, so the
      // two surfaces can never disagree about the same client.
      safeQuery(async () => {
        const today = await getClientTodayString(clientId);
        if ((await getNutritionPlanIdForDate(clientId, today)) != null) return true;
        return (await getNextFutureNutritionPlan(clientId, today)) != null;
      }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        hasTrainingPlan: trainingPlan !== null,
        hasNutritionPlan: hasNutritionPlan === true,
        hasHabits: Array.isArray(habits) && habits.length > 0,
      },
    });
  } catch (error) {
    console.error("Error checking activation readiness:", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json(
      { success: false, error: "Failed to check activation readiness" },
      { status: 500 }
    );
  }
}
