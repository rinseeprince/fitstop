import { supabaseAdmin } from "./supabase-admin";
import type {
  TrainingPlan,
  TrainingPlanHistory,
} from "@/types/training";

// Save training plan to history
export const saveTrainingPlanHistory = async (
  clientId: string,
  planId: string,
  plan: TrainingPlan,
  coachPrompt: string,
  aiResponseRaw: string,
  coachId: string,
  regenerationReason?: string
): Promise<void> => {
  const { error } = await supabaseAdmin.from("training_plan_history").insert({
    client_id: clientId,
    plan_id: planId,
    coach_prompt: coachPrompt,
    ai_response_raw: aiResponseRaw,
    plan_snapshot: plan,
    client_metrics_snapshot: {
      weightKg: plan.clientWeightKg,
      bodyFatPercentage: plan.clientBodyFatPercentage,
      goalWeightKg: plan.clientGoalWeightKg,
      tdee: plan.clientTdee,
    },
    check_in_data_snapshot: {
      avgMood: plan.avgMood,
      avgEnergy: plan.avgEnergy,
      avgSleep: plan.avgSleep,
      avgStress: plan.avgStress,
      adherencePercentage: plan.recentAdherencePercentage,
    },
    regeneration_reason: regenerationReason || "initial",
    created_by_coach_id: coachId,
  });

  if (error) console.error("Failed to save training plan history:", error);
};

// Get training plan history
export const getTrainingPlanHistory = async (clientId: string): Promise<TrainingPlanHistory[]> => {
  const { data, error } = await supabaseAdmin
    .from("training_plan_history")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch history: ${error.message}`);

  type HistoryRow = {
    id: string;
    client_id: string;
    plan_id: string | null;
    coach_prompt: string;
    ai_response_raw: string | null;
    plan_snapshot: TrainingPlan;
    client_metrics_snapshot: TrainingPlanHistory["clientMetricsSnapshot"];
    check_in_data_snapshot: TrainingPlanHistory["checkInDataSnapshot"];
    regeneration_reason: string | null;
    created_by_coach_id: string | null;
    created_at: string;
  };

  return ((data || []) as HistoryRow[]).map((row) => ({
    id: row.id,
    clientId: row.client_id,
    planId: row.plan_id ?? undefined,
    coachPrompt: row.coach_prompt,
    aiResponseRaw: row.ai_response_raw ?? undefined,
    planSnapshot: row.plan_snapshot,
    clientMetricsSnapshot: row.client_metrics_snapshot,
    checkInDataSnapshot: row.check_in_data_snapshot,
    regenerationReason: row.regeneration_reason ?? undefined,
    createdByCoachId: row.created_by_coach_id ?? undefined,
    createdAt: row.created_at,
  }));
};
