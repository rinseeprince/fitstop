import { NextRequest, NextResponse } from "next/server";
import { requireClientAuth } from "@/lib/require-client-auth";
import {
  getTodaysNutritionTarget,
  getTodaysTrainingSession,
} from "@/services/daily-context-service";
import { validateDateParameter } from "@/lib/validation-helpers";

export async function GET(request: NextRequest) {
  const auth = await requireClientAuth(request);
  if (!auth.ok) return auth.response;

  try {
    // Get date from query params
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");

    // Validate date if provided
    const dateValidation = validateDateParameter(date);
    if (dateValidation) return dateValidation;

    const [nutritionTarget, trainingSession] = await Promise.all([
      getTodaysNutritionTarget(auth.clientId, date || undefined),
      getTodaysTrainingSession(auth.clientId, date || undefined),
    ]);

    return NextResponse.json(
      {
        success: true,
        data: {
          nutritionTarget,
          trainingSession,
        },
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (error) {
    console.error("Error fetching nutrition target and context:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch nutrition target",
      },
      { status: 500 }
    );
  }
}