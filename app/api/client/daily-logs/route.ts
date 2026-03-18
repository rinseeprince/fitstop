import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClientId } from "@/lib/auth-helpers";
import { clientApiRateLimit } from "@/lib/rate-limit";
import { requireCSRFProtection } from "@/lib/csrf-protection";
import { dailyLogSchema } from "@/lib/validations/daily-log";
import { upsertDailyLog, getDailyLogs } from "@/services/daily-logs-service";
import { getTodaysNutritionTarget, getTodaysPlannedActivities } from "@/services/daily-context-service";
import { getClientTrainingPlan } from "@/services/client-portal-training";
import { calculateUnplannedActivityCalories, calculateAdjustedDayTarget, calculateAdjustedMacros } from "@/utils/nutrition-tracking-helpers";
import { getTodayDateString, getDateDaysAgo, getWeekStart } from "@/lib/date-helpers";
import { upsertWeeklySummary } from "@/services/weekly-nutrition-service";
import type { IntensityLevel } from "@/types/external-activity";

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
      console.error("Daily log validation failed:", validationResult.error.format());
      return NextResponse.json(
        { success: false, error: "Invalid input data" },
        { status: 400 }
      );
    }

    const data = validationResult.data;
    
    // Get nutrition targets and training data for the log's date to calculate adjusted targets
    const nutritionTarget = await getTodaysNutritionTarget(clientId, data.date);
    const trainingPlan = await getClientTrainingPlan(clientId);
    const plannedActivities = await getTodaysPlannedActivities(clientId, data.date);
    
    let adjustedTargets = {
      targetCalories: nutritionTarget?.calories,
      targetProteinG: nutritionTarget?.proteinG,
      targetCarbsG: nutritionTarget?.carbsG,
      targetFatG: nutritionTarget?.fatG,
    };
    
    // Calculate adjusted targets based on training state if nutrition target exists
    if (nutritionTarget && data.trainingData) {
      const trainingData = data.trainingData;
      const burnIncluded = nutritionTarget.includeActivityBurn !== false;

      // Calculate completed training calories based on the actually selected session
      let completedTrainingCals = 0;
      if (burnIncluded && trainingData.sessionCompleted && trainingData.trainingSessionId && trainingPlan) {
        const selectedSession = trainingPlan.sessions.find(s => s.id === trainingData.trainingSessionId);
        completedTrainingCals = selectedSession?.estimatedCalories || 0;
      }

      // Calculate completed planned activity calories
      const completedActivityCals = burnIncluded
        ? plannedActivities.reduce((sum, activity) =>
            sum + (trainingData.activityStatuses[activity.sessionId]?.completed ? activity.estimatedCalories : 0), 0)
        : 0;

      // Calculate unplanned activity calories
      const _unplannedActivityCals = trainingData.unplannedActivities.reduce((sum, activity) =>
        sum + calculateUnplannedActivityCalories({
          activityName: activity.activityName,
          intensityLevel: activity.intensityLevel as IntensityLevel,
          durationMinutes: activity.durationMinutes
        }), 0
      );

      // Calculate adjusted calorie target (NO unplanned activities in target calculation)
      const adjustedCalories = calculateAdjustedDayTarget(
        nutritionTarget.baselineCalories,
        completedTrainingCals,
        completedActivityCals
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

    // Recalculate weekly summary (fire-and-forget, non-blocking)
    upsertWeeklySummary(clientId, getWeekStart(data.date)).catch((err) =>
      console.error("Weekly summary recalculation failed:", err instanceof Error ? err.message : "Unknown error")
    );

    return NextResponse.json({
      success: true,
      data: dailyLog,
    });
  } catch (error) {
    console.error("Error upserting daily log:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to save daily log",
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
        error: "Failed to fetch daily logs",
      },
      { status: 500 }
    );
  }
}