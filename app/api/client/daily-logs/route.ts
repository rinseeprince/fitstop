import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { clientApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { dailyLogSchema } from "@/lib/validations/daily-log";
import { upsertDailyLog, getDailyLogs, getTodaysNutritionTarget, getTodaysTrainingSession, getTodaysPlannedActivities } from "@/services/daily-logs-service";
import { calculateUnplannedActivityCalories, calculateAdjustedDayTarget, calculateAdjustedMacros } from "@/utils/nutrition-tracking-helpers";
import { getTodayDateString, getDateDaysAgo } from "@/lib/date-helpers";

export async function POST(request: NextRequest) {
  const rateLimitResult = await clientApiRateLimit(request);
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
      trainingData: rawBody.trainingData,
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
    
    // Get nutrition targets and training data for today to calculate adjusted targets
    const nutritionTarget = await getTodaysNutritionTarget(clientId);
    const todaysTrainingSession = await getTodaysTrainingSession(clientId);
    const plannedActivities = await getTodaysPlannedActivities(clientId);
    
    let adjustedTargets = {
      targetCalories: nutritionTarget?.calories,
      targetProteinG: nutritionTarget?.proteinG,
      targetCarbsG: nutritionTarget?.carbsG,
      targetFatG: nutritionTarget?.fatG,
    };
    
    // Calculate adjusted targets based on training state if nutrition target exists
    if (nutritionTarget && data.trainingData) {
      const trainingData = data.trainingData;
      
      // Calculate completed training calories
      const completedTrainingCals = trainingData.sessionCompleted && todaysTrainingSession
        ? (todaysTrainingSession.estimatedCalories || 0)
        : 0;
      
      // Calculate completed planned activity calories
      const completedActivityCals = plannedActivities.reduce((sum, activity) => 
        sum + (trainingData.activityStatuses[activity.sessionId] ? activity.estimatedCalories : 0), 0
      );
      
      // Calculate unplanned activity calories
      const unplannedActivityCals = trainingData.unplannedActivities.reduce((sum, activity) => 
        sum + calculateUnplannedActivityCalories({
          activityName: activity.activityName,
          intensityLevel: activity.intensityLevel as "low" | "moderate" | "vigorous",
          durationMinutes: activity.durationMinutes
        }), 0
      );
      
      // Calculate adjusted calorie target
      const adjustedCalories = calculateAdjustedDayTarget(
        nutritionTarget.calories,
        completedTrainingCals,
        0, // skippedTrainingCals
        completedActivityCals,
        0, // skippedActivityCals
        unplannedActivityCals
      );
      
      // Calculate adjusted macros
      const adjustedMacros = calculateAdjustedMacros(
        adjustedCalories,
        nutritionTarget.proteinG,
        nutritionTarget.carbsG,
        nutritionTarget.fatG
      );
      
      adjustedTargets = {
        targetCalories: adjustedCalories,
        targetProteinG: adjustedMacros.proteinG,
        targetCarbsG: adjustedMacros.carbsG,
        targetFatG: adjustedMacros.fatG,
      };
    }
    
    // Add adjusted targets to the validated data
    const dataWithTargets = {
      ...data,
      ...adjustedTargets,
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
  const rateLimitResult = await clientApiRateLimit(request);
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
    const endDate = searchParams.get("endDate") || getTodayDateString();
    const startDate = searchParams.get("startDate") || getDateDaysAgo(30);

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