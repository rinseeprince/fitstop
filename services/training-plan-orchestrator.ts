import { getClientById } from "@/services/client-service";
import { getClientCheckIns } from "@/services/check-in-service";
import { generateTrainingPlanAI, calculateCheckInAverages } from "@/services/training-ai-service";
import { createSavedPlanFromAI } from "@/services/coach-saved-plan-service";
import { weightToKg } from "@/utils/nutrition-helpers";
import { getLatestBodyMetrics } from "@/services/body-metrics-service";
import { getCurrentGoals } from "@/services/client-goals-service";

export class TrainingPlanError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = "TrainingPlanError";
  }
}

interface GenerateTrainingPlanInput {
  coachPrompt: string;
  coachSuppliedName?: string;
  effectiveFrom?: string;
}

export interface TrainingPlanResult {
  success: true;
  savedPlanId: string;
}

/**
 * Orchestrate AI-based training plan generation.
 * Gathers client context, calls AI, and saves the result as a library draft.
 * The coach previews and edits the draft before applying to a client (LIB-3).
 *
 * Throws TrainingPlanError for validation / business-logic failures.
 */
export async function orchestrateTrainingPlanGeneration(
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

  const currentWeightKg = currentWeight
    ? weightToKg(currentWeight, weightUnit)
    : undefined;
  const goalWeightKg = goalWeight
    ? weightToKg(goalWeight, weightUnit)
    : undefined;

  // Get recent check-ins for context
  const { checkIns } = await getClientCheckIns(clientId, { limit: 4 });
  const checkInData = calculateCheckInAverages(checkIns);

  const { plan: aiPlan } = await generateTrainingPlanAI({
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
  });

  // Save as a library draft (coach previews/edits before applying to client)
  const savedPlanId = await createSavedPlanFromAI(
    coachId,
    aiPlan,
    input.coachPrompt,
    input.coachSuppliedName,
  );

  return { success: true, savedPlanId };
}
