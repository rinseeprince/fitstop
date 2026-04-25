import { supabaseAdmin } from "./supabase-admin";
import type { TrainingPlan, TrainingSession, TrainingExercise, AIGeneratedPlan, UpdateTrainingPlanRequest } from "@/types/training";
import type { TrainingPlanUpdate } from "@/lib/database-helpers";
import { mapExerciseRow, mapSessionRow, mapPlanRow } from "./training-mappers";
import { getTodayDateString, getDateString } from "@/lib/date-helpers";
import { deleteFutureEventsForPlan, regenerateFutureEvents } from "@/services/training-event-service";
import { captureApiError } from "@/lib/error-handler";

// Re-export moved functions so existing imports continue to work
export { updateSession, addSession, deleteSession, replaceSessionExercises, getSessionWithExercises, insertTrainingSessions, reorderSessions, updateSessionCalories, updateSurplusForFutureEvents } from "./training-session-service";
export { updateExercise, addExercise, deleteExercise } from "./training-exercise-service";
export { saveTrainingPlanHistory, getTrainingPlanHistory } from "./training-plan-history-service";

// Create a new training plan with sessions and exercises
export const createTrainingPlan = async (
  clientId: string,
  coachId: string,
  aiPlan: AIGeneratedPlan,
  coachPrompt: string,
  aiResponseRaw: string,
  clientMetrics: {
    weightKg?: number;
    bodyFatPercentage?: number;
    goalWeightKg?: number;
    tdee?: number;
  },
  checkInData?: {
    avgMood?: number;
    avgEnergy?: number;
    avgSleep?: number;
    avgStress?: number;
    adherencePercentage?: number;
  },
  phaseId?: string
): Promise<TrainingPlan> => {
  // Insert the plan
  const { data: planRow, error: planError } = await supabaseAdmin
    .from("training_plans")
    .insert({
      client_id: clientId,
      coach_id: coachId,
      name: aiPlan.name,
      description: aiPlan.description,
      status: "active",
      coach_prompt: coachPrompt,
      ai_response_raw: aiResponseRaw,
      split_type: aiPlan.splitType,
      frequency_per_week: aiPlan.frequencyPerWeek,
      program_duration_weeks: aiPlan.programDurationWeeks || null,
      client_weight_kg: clientMetrics.weightKg || null,
      client_body_fat_percentage: clientMetrics.bodyFatPercentage || null,
      client_goal_weight_kg: clientMetrics.goalWeightKg || null,
      client_tdee: clientMetrics.tdee || null,
      phase_id: phaseId || null,
      avg_mood: checkInData?.avgMood || null,
      avg_energy: checkInData?.avgEnergy || null,
      avg_sleep: checkInData?.avgSleep || null,
      avg_stress: checkInData?.avgStress || null,
      recent_adherence_percentage: checkInData?.adherencePercentage || null,
    })
    .select()
    .single();

  if (planError || !planRow) throw new Error(`Failed to create plan: ${planError?.message || "No data returned"}`);

  const planId = planRow.id;
  const sessions: TrainingSession[] = [];

  // Insert sessions and exercises
  for (let i = 0; i < aiPlan.sessions.length; i++) {
    const sessionData = aiPlan.sessions[i];

    const { data: sessionRow, error: sessionError } = await supabaseAdmin
      .from("training_sessions")
      .insert({
        plan_id: planId,
        name: sessionData.name,
        day_of_week: sessionData.dayOfWeek || null,
        order_index: i,
        focus: sessionData.focus || null,
        notes: sessionData.notes || null,
        estimated_duration_minutes: sessionData.estimatedDurationMinutes || null,
      })
      .select()
      .single();

    if (sessionError || !sessionRow) throw new Error(`Failed to create session: ${sessionError?.message || "No data returned"}`);

    const exercises: TrainingExercise[] = [];

    // Insert exercises for this session
    for (let j = 0; j < sessionData.exercises.length; j++) {
      const exerciseData = sessionData.exercises[j];

      const { data: exerciseRow, error: exerciseError } = await supabaseAdmin
        .from("training_exercises")
        .insert({
          session_id: sessionRow.id,
          name: exerciseData.name,
          order_index: j,
          sets: exerciseData.sets,
          reps_min: exerciseData.repsMin || null,
          reps_max: exerciseData.repsMax || null,
          reps_target: exerciseData.repsTarget || null,
          rpe_target: exerciseData.rpeTarget || null,
          percentage_1rm: exerciseData.percentage1rm || null,
          tempo: exerciseData.tempo || null,
          rest_seconds: exerciseData.restSeconds || null,
          notes: exerciseData.notes || null,
          superset_group: exerciseData.supersetGroup || null,
          is_warmup: exerciseData.isWarmup || false,
        })
        .select()
        .single();

      if (exerciseError || !exerciseRow) throw new Error(`Failed to create exercise: ${exerciseError?.message || "No data returned"}`);

      exercises.push(mapExerciseRow(exerciseRow));
    }

    sessions.push(mapSessionRow(sessionRow, exercises));
  }

  return mapPlanRow(planRow, sessions);
};

// Fetch sessions with exercises for a plan (shared helper)
const fetchSessionsWithExercises = async (planId: string): Promise<TrainingSession[]> => {
  const { data: sessionRows, error: sessionError } = await supabaseAdmin
    .from("training_sessions")
    .select("*")
    .eq("plan_id", planId)
    .eq("is_active", true)
    .order("order_index", { ascending: true });

  if (sessionError) throw new Error(`Failed to fetch sessions: ${sessionError.message}`);
  const sessionList = sessionRows || [];
  if (sessionList.length === 0) return [];

  const sessionIds = sessionList.map((s) => s.id);
  const { data: exerciseRows, error: exerciseError } = await supabaseAdmin
    .from("training_exercises")
    .select("*")
    .in("session_id", sessionIds)
    .eq("is_active", true)
    .order("order_index", { ascending: true });

  if (exerciseError) throw new Error(`Failed to fetch exercises: ${exerciseError.message}`);
  const exercisesBySession = new Map<string, TrainingExercise[]>();
  for (const row of exerciseRows || []) {
    const sessionId = row.session_id;
    if (!exercisesBySession.has(sessionId)) {
      exercisesBySession.set(sessionId, []);
    }
    exercisesBySession.get(sessionId)!.push(mapExerciseRow(row));
  }

  return sessionList.map((sessionRow) =>
    mapSessionRow(sessionRow, exercisesBySession.get(sessionRow.id) || [])
  );
};

// Get active training plan for a client
export const getActiveTrainingPlan = async (clientId: string): Promise<TrainingPlan | null> => {
  const { data: planRow, error: planError } = await supabaseAdmin
    .from("training_plans")
    .select("*")
    .eq("client_id", clientId)
    .eq("status", "active")
    .is("deleted_at", null)
    .is("effective_until", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (planError || !planRow) return null;
  const sessions = await fetchSessionsWithExercises(planRow.id);
  return mapPlanRow(planRow, sessions);
};

// Get training plan that was active on a specific date
export const getTrainingPlanForDate = async (
  clientId: string,
  date: string
): Promise<TrainingPlan | null> => {
  const { data: planRow, error: planError } = await supabaseAdmin
    .from("training_plans")
    .select("*")
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .lte("effective_from", date)
    .or(`effective_until.gte.${date},effective_until.is.null`)
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (planError || !planRow) return null;
  const sessions = await fetchSessionsWithExercises(planRow.id);
  return mapPlanRow(planRow, sessions);
};

// Get training plan by ID
export const getTrainingPlanById = async (planId: string): Promise<TrainingPlan | null> => {
  const { data: planRow, error: planError } = await supabaseAdmin
    .from("training_plans")
    .select("*")
    .eq("id", planId)
    .single();
  if (planError || !planRow) return null;
  const sessions = await fetchSessionsWithExercises(planId);
  return mapPlanRow(planRow, sessions);
};

// Update training plan
export const updateTrainingPlan = async (
  planId: string,
  updates: UpdateTrainingPlanRequest
): Promise<TrainingPlan> => {
  const updateData: Partial<TrainingPlanUpdate> = { updated_at: new Date().toISOString() };

  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.description !== undefined) updateData.description = updates.description;
  if (updates.status !== undefined) updateData.status = updates.status;
  if (updates.frequencyPerWeek !== undefined) updateData.frequency_per_week = updates.frequencyPerWeek;
  if (updates.programDurationWeeks !== undefined)
    updateData.program_duration_weeks = updates.programDurationWeeks;

  const { error } = await supabaseAdmin
    .from("training_plans")
    .update(updateData)
    .eq("id", planId);

  if (error) throw new Error(`Failed to update plan: ${error.message}`);

  const plan = await getTrainingPlanById(planId);
  if (!plan) throw new Error("Plan not found after update");
  return plan;
};

// Archive training plan
export const archiveTrainingPlan = async (planId: string): Promise<void> => {
  const { error } = await supabaseAdmin
    .from("training_plans")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", planId);

  if (error) throw new Error(`Failed to archive plan: ${error.message}`);
};

// Atomically archive old plan + insert new plan via RPC
export const createTrainingPlanAtomic = async (params: {
  clientId: string;
  coachId: string;
  name: string;
  description?: string;
  coachPrompt: string;
  aiResponseRaw?: string;
  splitType: string;
  frequencyPerWeek: number;
  programDurationWeeks?: number;
  clientWeightKg?: number;
  clientBodyFatPercentage?: number;
  clientGoalWeightKg?: number;
  clientTdee?: number;
  avgMood?: number;
  avgEnergy?: number;
  avgSleep?: number;
  avgStress?: number;
  recentAdherencePercentage?: number;
  phaseId?: string;
  effectiveFrom?: string;
  savedPlanId?: string;
}): Promise<string> => {
  const { data: newPlanId, error: rpcError } = await supabaseAdmin
    .rpc("create_training_plan_atomic" as never, {
      p_client_id: params.clientId,
      p_coach_id: params.coachId,
      p_name: params.name,
      p_description: params.description || null,
      p_coach_prompt: params.coachPrompt,
      p_ai_response_raw: params.aiResponseRaw || null,
      p_split_type: params.splitType,
      p_frequency_per_week: params.frequencyPerWeek,
      p_program_duration_weeks: params.programDurationWeeks || null,
      p_client_weight_kg: params.clientWeightKg || null,
      p_client_body_fat_percentage: params.clientBodyFatPercentage || null,
      p_client_goal_weight_kg: params.clientGoalWeightKg || null,
      p_client_tdee: params.clientTdee || null,
      p_avg_mood: params.avgMood || null,
      p_avg_energy: params.avgEnergy || null,
      p_avg_sleep: params.avgSleep || null,
      p_avg_stress: params.avgStress || null,
      p_recent_adherence_percentage: params.recentAdherencePercentage || null,
      p_phase_id: params.phaseId || null,
      p_effective_from: params.effectiveFrom || null,
      p_saved_plan_id: params.savedPlanId || null,
    } as never) as unknown as { data: string | null; error: { message: string } | null };

  if (rpcError || !newPlanId) {
    throw new Error(`Failed to create training plan atomically: ${rpcError?.message || "No data returned"}`);
  }

  return newPlanId as string;
};

/**
 * Lazy promotion: if a planned training plan's effective_from has arrived,
 * promote it to active and archive the current active plan.
 * Called before any read of the active training plan.
 *
 * supabaseAdmin: system-level write for plan lifecycle management.
 */
export async function promoteTrainingPlanIfReady(
  clientId: string
): Promise<{ promoted: boolean; newPlanId?: string }> {
  const today = getTodayDateString();

  const { data: plannedPlan, error } = await supabaseAdmin
    .from("training_plans")
    .select("id, effective_from")
    .eq("client_id", clientId)
    .eq("status", "planned")
    .lte("effective_from", today)
    .maybeSingle();

  if (error || !plannedPlan) return { promoted: false };

  // Capture old active plan ID before archiving it
  const { data: oldActivePlan } = await supabaseAdmin
    .from("training_plans")
    .select("id")
    .eq("client_id", clientId)
    .eq("status", "active")
    .maybeSingle();

  // Archive the current active plan
  const archiveUntil = new Date(plannedPlan.effective_from + "T00:00:00");
  archiveUntil.setDate(archiveUntil.getDate() - 1);
  const archiveUntilStr = getDateString(archiveUntil);

  await supabaseAdmin
    .from("training_plans")
    .update({
      status: "archived",
      effective_until: archiveUntilStr,
      updated_at: new Date().toISOString(),
    })
    .eq("client_id", clientId)
    .eq("status", "active");

  // Promote planned to active
  await supabaseAdmin
    .from("training_plans")
    .update({
      status: "active",
      effective_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", plannedPlan.id);

  // Clean up old plan's future events, generate for promoted plan
  if (oldActivePlan) {
    await deleteFutureEventsForPlan(oldActivePlan.id).catch((err) =>
      captureApiError(err, { action: "delete-future-training-events-promote", planId: oldActivePlan.id })
    );
  }
  await regenerateFutureEvents(clientId, plannedPlan.id).catch((err) =>
    captureApiError(err, { action: "generate-training-events-promote", planId: plannedPlan.id })
  );

  return { promoted: true, newPlanId: plannedPlan.id };
}

