import { NextRequest, NextResponse } from "next/server";
import { requireCoachOwnsClient } from "@/lib/require-coach-auth";
import { getActiveTrainingPlan } from "@/services/training-service";
import { hasHabitFromToday } from "@/services/client-habit-figures-service";
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
    const { id: clientId } = await params;
    const auth = await requireCoachOwnsClient(clientId, request);
    if (!auth.authorized) return auth.response;

    // The client's today, read once for the two items judged on it and
    // awaited inside each, so a failed read still fails each item alone.
    const today = getClientTodayString(clientId);
    const [trainingPlan, hasHabits, hasNutritionPlan] = await Promise.all([
      safeQuery(() => getActiveTrainingPlan(clientId)),
      // A habit running on the client's today or starting later: a habit
      // queued to start IS set up, and a stopped one is not.
      safeQuery(async () => hasHabitFromToday(clientId, await today)),
      // Versioned model (migration 144): ready = a version covers the client's
      // today OR one is queued — a coach who queued a first plan IS set up.
      // The same covering-or-future predicate as the client log guard, so the
      // two surfaces can never disagree about the same client.
      safeQuery(async () => {
        const day = await today;
        if ((await getNutritionPlanIdForDate(clientId, day)) != null) return true;
        return (await getNextFutureNutritionPlan(clientId, day)) != null;
      }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        hasTrainingPlan: trainingPlan !== null,
        hasNutritionPlan: hasNutritionPlan === true,
        hasHabits: hasHabits === true,
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
