import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { apiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { dailyLogSchema } from "@/lib/validations/daily-log";
import { upsertDailyLog, getDailyLogs, getTodaysNutritionTarget } from "@/services/daily-logs-service";

export async function POST(request: NextRequest) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  const csrfError = await requireCSRFProtection(request);
  if (csrfError) return csrfError;

  try {
    const clientId = await getAuthenticatedClientId();

    if (!clientId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const rawBody = await request.json();
    
    // Convert snake_case to camelCase for compatibility
    const normalizedBody = {
      ...rawBody,
      caloriesConsumed: rawBody.caloriesConsumed ?? rawBody.calories_consumed,
      proteinG: rawBody.proteinG ?? rawBody.protein_g,
      carbsG: rawBody.carbsG ?? rawBody.carbs_g,
      fatG: rawBody.fatG ?? rawBody.fat_g,
      trainingSessionId: rawBody.trainingSessionId ?? rawBody.training_session_id,
    };
    
    const validationResult = dailyLogSchema.safeParse(normalizedBody);

    if (!validationResult.success) {
      return NextResponse.json(
        { 
          success: false, 
          error: "Invalid input data",
          validationErrors: validationResult.error.format()
        },
        { status: 400 }
      );
    }

    const data = validationResult.data;
    
    // Get nutrition targets for today to include in the log
    const nutritionTarget = await getTodaysNutritionTarget(clientId);
    
    // Add nutrition targets to the validated data
    const dataWithTargets = {
      ...data,
      targetCalories: nutritionTarget?.calories,
      targetProteinG: nutritionTarget?.proteinG,
      targetCarbsG: nutritionTarget?.carbsG,
      targetFatG: nutritionTarget?.fatG,
    };
    
    const dailyLog = await upsertDailyLog(clientId, dataWithTargets);

    return NextResponse.json({
      success: true,
      data: dailyLog,
    });
  } catch (error) {
    console.error("Error upserting daily log:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to save daily log",
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const rateLimitResult = await apiRateLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const clientId = await getAuthenticatedClientId();

    if (!clientId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    
    // Default to last 30 days if not provided
    const endDate = searchParams.get("endDate") || new Date().toISOString().split('T')[0];
    const defaultStartDate = new Date();
    defaultStartDate.setDate(defaultStartDate.getDate() - 30);
    const startDate = searchParams.get("startDate") || defaultStartDate.toISOString().split('T')[0];

    const logs = await getDailyLogs(clientId, startDate, endDate);

    return NextResponse.json({
      success: true,
      data: logs,
    });
  } catch (error) {
    console.error("Error fetching daily logs:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch daily logs",
      },
      { status: 500 }
    );
  }
}