import { getClientById } from "@/services/client-service";
import { getClientCheckIns } from "@/services/check-in-service";
import { generateTrainingPlanAI, calculateCheckInAverages } from "@/services/training-ai-service";
import {
  getActiveTrainingPlan,
  createTrainingPlanAtomic,
  insertTrainingSessions,
  getTrainingPlanById,
  saveTrainingPlanHistory,
  updateSessionCalories,
} from "@/services/training-service";
import { addExternalActivity } from "@/services/activity-service";
import { estimateSessionCalories } from "@/services/training-calorie-service";
import { weightToKg } from "@/utils/nutrition-helpers";
import { getLatestBodyMetrics } from "@/services/body-metrics-service";
import { getCurrentGoals } from "@/services/client-goals-service";
import { requirePhaseSelection } from "@/lib/require-phase-selection";
import { deleteFutureEventsForPlan, regenerateFutureEvents } from "@/services/training-event-service";
import { regenerateFutureNutritionEvents } from "@/services/nutrition-event-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import { captureApiError } from "@/lib/error-handler";
import type { ExternalActivityContext } from "@/types/training";
import type { ActivityMetadata, MuscleGroup, IntensityLevel } from "@/types/external-activity";
import type { z } from "zod";
import type { preGenerationActivitySchema } from "@/lib/validations/training";

export class TrainingPlanError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = "TrainingPlanError";
  }
}

// Helper function for default recovery hours based on intensity
function getDefaultRecoveryHours(intensity: IntensityLevel): number {
  switch (intensity) {
    case "low":
      return 12;
    case "moderate":
      return 24;
    case "vigorous":
      return 48;
    default:
      return 24;
  }
}

type PreGenActivity = z.infer<typeof preGenerationActivitySchema>;

interface GenerateTrainingPlanInput {
  coachPrompt: string;
  phaseId?: string;
  preGenerationActivities?: PreGenActivity[];
  allowSameDayTraining?: boolean;
  effectiveFrom?: string;
}

export interface TrainingPlanResult {
  success: true;
  plan: NonNullable<Awaited<ReturnType<typeof getActiveTrainingPlan>>>;
}

/**
 * Orchestrate AI-based training plan generation, including:
 * - AI plan generation
 * - Plan creation + session insertion
 * - External activity insertion
 * - Calorie estimation
 * - History saving
 * - Calendar event generation
 *
 * Throws TrainingPlanError for validation / business-logic failures.
 */
export async function orchestrateTrainingPlanCreation(
  clientId: string,
  coachId: string,
  input: GenerateTrainingPlanInput
): Promise<TrainingPlanResult> {
  const client = await getClientById(clientId);

  if (!client) {
    throw new TrainingPlanError("Client not found", 404);
  }
  if (client.coachId !== coachId) {
    throw new TrainingPlanError("Forbidden: You don't have access to this client", 403);
  }

  // Enforce phase selection when client has an active roadmap
  const phaseCheck = await requirePhaseSelection(clientId, input.phaseId);
  if (!phaseCheck.ok) {
    throw new TrainingPlanError("Phase selection required", 400);
  }

  // Prefer new services, fall back to client.* for pre-migration clients
  const [latestMetrics, currentGoals] = await Promise.all([
    getLatestBodyMetrics(clientId),
    getCurrentGoals(clientId),
  ]);

  const currentWeight = latestMetrics?.weight ?? client.currentWeight;
  const weightUnit = (latestMetrics?.weightUnit ?? client.weightUnit ?? "lbs") as "lbs" | "kg";
  const bodyFatPercentage = latestMetrics?.bodyFatPercentage ?? client.currentBodyFatPercentage;
  const goalWeight = currentGoals?.goalWeight ?? client.goalWeight;
  const goalBodyFatPercentage = currentGoals?.goalBodyFatPercentage ?? client.goalBodyFatPercentage;
  const clientTdee = latestMetrics?.tdee ?? client.tdee;
  const clientBmr = latestMetrics?.bmr ?? client.bmr;

  // Gather client metrics
  const currentWeightKg = currentWeight
    ? weightToKg(currentWeight, weightUnit)
    : undefined;
  const goalWeightKg = goalWeight
    ? weightToKg(goalWeight, weightUnit)
    : undefined;

  // Get recent check-ins for context
  const { checkIns } = await getClientCheckIns(clientId, { limit: 4 });
  const checkInData = calculateCheckInAverages(checkIns);

  // Convert pre-generation activities to external activity context for AI
  const preGenActivities = input.preGenerationActivities || [];
  const externalActivities: ExternalActivityContext[] = preGenActivities.map((activity) => ({
    activityName: activity.activityName,
    dayOfWeek: activity.dayOfWeek,
    intensityLevel: activity.intensityLevel,
    durationMinutes: activity.durationMinutes,
    recoveryHours: activity.analysis?.recoveryHours || getDefaultRecoveryHours(activity.intensityLevel),
    muscleGroupsImpacted: (activity.analysis?.muscleGroupsImpacted || ["full_body"]) as MuscleGroup[],
    recoveryImpact: activity.analysis?.recoveryImpact || "",
  }));

  // Check if there's an existing plan (for history reason tracking)
  const existingPlan = await getActiveTrainingPlan(clientId);
  const hadExistingPlan = !!existingPlan;

  // Generate plan via AI with external activities as context
  const { plan: aiPlan, rawResponse } = await generateTrainingPlanAI({
    coachPrompt: input.coachPrompt,
    client: {
      name: client.name,
      currentWeightKg,
      goalWeightKg,
      bodyFatPercentage,
      goalBodyFatPercentage,
      tdee: clientTdee,
      bmr: clientBmr,
      gender: client.gender,
    },
    checkInData,
    externalActivities: externalActivities.length > 0 ? externalActivities : undefined,
    allowSameDayTraining: input.allowSameDayTraining,
  });

  // Atomically archive old plan + insert new plan row
  const newPlanId = await createTrainingPlanAtomic({
    clientId,
    coachId,
    name: aiPlan.name,
    description: aiPlan.description,
    coachPrompt: input.coachPrompt,
    aiResponseRaw: rawResponse,
    splitType: aiPlan.splitType,
    frequencyPerWeek: aiPlan.frequencyPerWeek,
    programDurationWeeks: aiPlan.programDurationWeeks,
    clientWeightKg: currentWeightKg,
    clientBodyFatPercentage: bodyFatPercentage,
    clientGoalWeightKg: goalWeightKg,
    clientTdee: clientTdee,
    avgMood: checkInData?.avgMood,
    avgEnergy: checkInData?.avgEnergy,
    avgSleep: checkInData?.avgSleep,
    avgStress: checkInData?.avgStress,
    recentAdherencePercentage: checkInData?.adherencePercentage,
    phaseId: phaseCheck.phaseId,
    effectiveFrom: input.effectiveFrom,
  });

  // Insert sessions and exercises
  await insertTrainingSessions(newPlanId, aiPlan.sessions, coachId);
  const plan = await getTrainingPlanById(newPlanId);
  if (!plan) {
    throw new TrainingPlanError("Failed to retrieve created plan", 500);
  }

  // Save pre-generation activities as external activities in the plan
  for (const activity of preGenActivities) {
    const activityMetadata: ActivityMetadata = {
      activityName: activity.activityName,
      intensityLevel: activity.intensityLevel,
      durationMinutes: activity.durationMinutes,
      estimatedCalories: activity.analysis?.estimatedCalories || 0,
      metValue: activity.analysis?.metValue || 5,
      recoveryImpact: activity.analysis?.recoveryImpact || "",
      recoveryHours: activity.analysis?.recoveryHours || getDefaultRecoveryHours(activity.intensityLevel),
      muscleGroupsImpacted: (activity.analysis?.muscleGroupsImpacted || ["full_body"]) as MuscleGroup[],
    };

    await addExternalActivity(
      plan.id,
      {
        activityName: activity.activityName,
        dayOfWeek: activity.dayOfWeek,
        durationMinutes: activity.durationMinutes,
        notes: activity.notes ?? undefined,
      },
      activityMetadata
    );
  }

  // Refetch plan to include the newly added external activities
  // For planned plans, fetch by ID since getActiveTrainingPlan returns the old active plan
  let updatedPlan = input.effectiveFrom
    ? await getTrainingPlanById(newPlanId)
    : await getActiveTrainingPlan(clientId);

  // Estimate calories for all training sessions
  if (updatedPlan) {
    for (const session of updatedPlan.sessions) {
      if (session.sessionType === "training" && session.exercises && session.exercises.length > 0) {
        const estimate = await estimateSessionCalories(session, currentWeightKg || 70);
        await updateSessionCalories(session.id, estimate.estimatedCalories);
      }
    }
    // Refetch to include updated calories
    updatedPlan = input.effectiveFrom
      ? await getTrainingPlanById(newPlanId)
      : await getActiveTrainingPlan(clientId);
  }

  // Save to history
  await saveTrainingPlanHistory(
    clientId,
    plan.id,
    updatedPlan || plan,
    input.coachPrompt,
    rawResponse,
    coachId,
    hadExistingPlan ? "regenerated" : "initial"
  );

  // Generate calendar events for the new plan
  // First creation: start from phase start date. Regeneration: use coach's chosen date.
  const effectiveFrom = hadExistingPlan
    ? input.effectiveFrom
    : phaseCheck.phaseStartDate ?? undefined;

  if (existingPlan) {
    await deleteFutureEventsForPlan(existingPlan.id, effectiveFrom).catch((err) =>
      captureApiError(err, { action: "delete-future-events", planId: existingPlan.id })
    );
  }
  await regenerateFutureEvents(clientId, newPlanId, effectiveFrom).catch((err) =>
    captureApiError(err, { action: "generate-training-events", planId: newPlanId })
  );

  // Cascade: regenerate nutrition events so burns match the new training schedule
  const { data: nutritionPlans } = await supabaseAdmin
    .from("nutrition_plans")
    .select("id, status")
    .eq("client_id", clientId)
    .in("status", ["active", "planned"]);

  for (const np of nutritionPlans ?? []) {
    const fromDate = np.status === "active" ? effectiveFrom : undefined;
    await regenerateFutureNutritionEvents(clientId, np.id, fromDate).catch((err) =>
      captureApiError(err, { action: "cascade-nutrition-events-from-training-plan", planId: np.id })
    );
  }

  return { success: true, plan: updatedPlan || plan };
}
