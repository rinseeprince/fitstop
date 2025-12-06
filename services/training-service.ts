import { supabaseAdmin } from "./supabase-admin";
import type {
  TrainingPlan,
  TrainingSession,
  TrainingExercise,
  TrainingPlanHistory,
  AIGeneratedPlan,
  UpdateTrainingPlanRequest,
  UpdateSessionRequest,
  UpdateExerciseRequest,
  AddSessionRequest,
  AddExerciseRequest,
  ReorderSessionItem,
} from "@/types/training";

// Map database row to TrainingExercise
const mapExerciseRow = (row: any): TrainingExercise => ({
  id: row.id,
  sessionId: row.session_id,
  name: row.name,
  orderIndex: row.order_index,
  sets: row.sets,
  repsMin: row.reps_min,
  repsMax: row.reps_max,
  repsTarget: row.reps_target,
  rpeTarget: row.rpe_target ? parseFloat(row.rpe_target) : undefined,
  percentage1rm: row.percentage_1rm ? parseFloat(row.percentage_1rm) : undefined,
  tempo: row.tempo,
  restSeconds: row.rest_seconds,
  notes: row.notes,
  supersetGroup: row.superset_group,
  isWarmup: row.is_warmup || false,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// Map database row to TrainingSession
const mapSessionRow = (row: any, exercises: TrainingExercise[] = []): TrainingSession => ({
  id: row.id,
  planId: row.plan_id,
  name: row.name,
  dayOfWeek: row.day_of_week,
  orderIndex: row.order_index,
  focus: row.focus,
  notes: row.notes,
  estimatedDurationMinutes: row.estimated_duration_minutes,
  exercises,
  sessionType: row.session_type || "training",
  activityMetadata: row.activity_metadata,
  estimatedCalories: row.estimated_calories,
  caloriesCalculatedAt: row.calories_calculated_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// Map database row to TrainingPlan
const mapPlanRow = (row: any, sessions: TrainingSession[] = []): TrainingPlan => ({
  id: row.id,
  clientId: row.client_id,
  coachId: row.coach_id,
  name: row.name,
  description: row.description,
  status: row.status,
  coachPrompt: row.coach_prompt,
  aiResponseRaw: row.ai_response_raw,
  splitType: row.split_type,
  frequencyPerWeek: row.frequency_per_week,
  programDurationWeeks: row.program_duration_weeks,
  clientWeightKg: row.client_weight_kg ? parseFloat(row.client_weight_kg) : undefined,
  clientBodyFatPercentage: row.client_body_fat_percentage
    ? parseFloat(row.client_body_fat_percentage)
    : undefined,
  clientGoalWeightKg: row.client_goal_weight_kg
    ? parseFloat(row.client_goal_weight_kg)
    : undefined,
  clientTdee: row.client_tdee,
  avgMood: row.avg_mood ? parseFloat(row.avg_mood) : undefined,
  avgEnergy: row.avg_energy ? parseFloat(row.avg_energy) : undefined,
  avgSleep: row.avg_sleep ? parseFloat(row.avg_sleep) : undefined,
  avgStress: row.avg_stress ? parseFloat(row.avg_stress) : undefined,
  recentAdherencePercentage: row.recent_adherence_percentage
    ? parseFloat(row.recent_adherence_percentage)
    : undefined,
  sessions,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  deletedAt: row.deleted_at,
});

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
  }
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
      avg_mood: checkInData?.avgMood || null,
      avg_energy: checkInData?.avgEnergy || null,
      avg_sleep: checkInData?.avgSleep || null,
      avg_stress: checkInData?.avgStress || null,
      recent_adherence_percentage: checkInData?.adherencePercentage || null,
    } as any)
    .select()
    .single();

  if (planError || !planRow) throw new Error(`Failed to create plan: ${planError?.message || "No data returned"}`);

  const planId = (planRow as any).id;
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
      } as any)
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
          session_id: (sessionRow as any).id,
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
        } as any)
        .select()
        .single();

      if (exerciseError || !exerciseRow) throw new Error(`Failed to create exercise: ${exerciseError?.message || "No data returned"}`);

      exercises.push(mapExerciseRow(exerciseRow));
    }

    sessions.push(mapSessionRow(sessionRow as any, exercises));
  }

  return mapPlanRow(planRow as any, sessions);
};

// Get active training plan for a client
export const getActiveTrainingPlan = async (clientId: string): Promise<TrainingPlan | null> => {
  const { data: planRow, error: planError } = await supabaseAdmin
    .from("training_plans")
    .select("*")
    .eq("client_id", clientId)
    .eq("status", "active")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (planError || !planRow) return null;

  const planData = planRow as any;

  // Get sessions
  const { data: sessionRows, error: sessionError } = await supabaseAdmin
    .from("training_sessions")
    .select("*")
    .eq("plan_id", planData.id)
    .order("order_index", { ascending: true });

  if (sessionError) throw new Error(`Failed to fetch sessions: ${sessionError.message}`);

  const sessionList = (sessionRows as any[]) || [];
  if (sessionList.length === 0) {
    return mapPlanRow(planData, []);
  }

  // Fetch all exercises in one query (fixes N+1)
  const sessionIds = sessionList.map((s) => s.id);
  const { data: exerciseRows, error: exerciseError } = await supabaseAdmin
    .from("training_exercises")
    .select("*")
    .in("session_id", sessionIds)
    .order("order_index", { ascending: true });

  if (exerciseError) throw new Error(`Failed to fetch exercises: ${exerciseError.message}`);

  // Group exercises by session_id
  const exercisesBySession = new Map<string, TrainingExercise[]>();
  for (const row of (exerciseRows as any[]) || []) {
    const sessionId = row.session_id;
    if (!exercisesBySession.has(sessionId)) {
      exercisesBySession.set(sessionId, []);
    }
    exercisesBySession.get(sessionId)!.push(mapExerciseRow(row));
  }

  // Build sessions with their exercises
  const sessions = sessionList.map((sessionRow) =>
    mapSessionRow(sessionRow, exercisesBySession.get(sessionRow.id) || [])
  );

  return mapPlanRow(planData, sessions);
};

// Get training plan by ID
export const getTrainingPlanById = async (planId: string): Promise<TrainingPlan | null> => {
  const { data: planRow, error: planError } = await supabaseAdmin
    .from("training_plans")
    .select("*")
    .eq("id", planId)
    .single();

  if (planError || !planRow) return null;

  const planData = planRow as any;

  const { data: sessionRows } = await supabaseAdmin
    .from("training_sessions")
    .select("*")
    .eq("plan_id", planId)
    .order("order_index", { ascending: true });

  const sessionList = (sessionRows as any[]) || [];
  if (sessionList.length === 0) {
    return mapPlanRow(planData, []);
  }

  // Fetch all exercises in one query (fixes N+1)
  const sessionIds = sessionList.map((s) => s.id);
  const { data: exerciseRows } = await supabaseAdmin
    .from("training_exercises")
    .select("*")
    .in("session_id", sessionIds)
    .order("order_index", { ascending: true });

  // Group exercises by session_id
  const exercisesBySession = new Map<string, TrainingExercise[]>();
  for (const row of (exerciseRows as any[]) || []) {
    const sessionId = row.session_id;
    if (!exercisesBySession.has(sessionId)) {
      exercisesBySession.set(sessionId, []);
    }
    exercisesBySession.get(sessionId)!.push(mapExerciseRow(row));
  }

  // Build sessions with their exercises
  const sessions = sessionList.map((sessionRow) =>
    mapSessionRow(sessionRow, exercisesBySession.get(sessionRow.id) || [])
  );

  return mapPlanRow(planData, sessions);
};

// Update training plan
export const updateTrainingPlan = async (
  planId: string,
  updates: UpdateTrainingPlanRequest
): Promise<TrainingPlan> => {
  const updateData: any = { updated_at: new Date().toISOString() };

  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.description !== undefined) updateData.description = updates.description;
  if (updates.status !== undefined) updateData.status = updates.status;
  if (updates.frequencyPerWeek !== undefined) updateData.frequency_per_week = updates.frequencyPerWeek;
  if (updates.programDurationWeeks !== undefined)
    updateData.program_duration_weeks = updates.programDurationWeeks;

  const { error } = await (supabaseAdmin as any)
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
  const { error } = await (supabaseAdmin as any)
    .from("training_plans")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", planId);

  if (error) throw new Error(`Failed to archive plan: ${error.message}`);
};

// Update session
export const updateSession = async (
  sessionId: string,
  updates: UpdateSessionRequest
): Promise<TrainingSession> => {
  const updateData: any = { updated_at: new Date().toISOString() };

  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.dayOfWeek !== undefined) updateData.day_of_week = updates.dayOfWeek;
  if (updates.orderIndex !== undefined) updateData.order_index = updates.orderIndex;
  if (updates.focus !== undefined) updateData.focus = updates.focus;
  if (updates.notes !== undefined) updateData.notes = updates.notes;
  if (updates.estimatedDurationMinutes !== undefined)
    updateData.estimated_duration_minutes = updates.estimatedDurationMinutes;

  const { data, error } = await (supabaseAdmin as any)
    .from("training_sessions")
    .update(updateData)
    .eq("id", sessionId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update session: ${error.message}`);

  const { data: exercises } = await (supabaseAdmin as any)
    .from("training_exercises")
    .select("*")
    .eq("session_id", sessionId)
    .order("order_index", { ascending: true });

  return mapSessionRow(data, (exercises || []).map(mapExerciseRow));
};

// Add session to plan
export const addSession = async (
  planId: string,
  session: AddSessionRequest
): Promise<TrainingSession> => {
  // Get max order index
  const { data: existingSessions } = await (supabaseAdmin as any)
    .from("training_sessions")
    .select("order_index")
    .eq("plan_id", planId)
    .order("order_index", { ascending: false })
    .limit(1);

  const nextOrderIndex = existingSessions?.[0]?.order_index !== undefined
    ? existingSessions[0].order_index + 1
    : 0;

  const { data, error } = await (supabaseAdmin as any)
    .from("training_sessions")
    .insert({
      plan_id: planId,
      name: session.name,
      day_of_week: session.dayOfWeek || null,
      order_index: nextOrderIndex,
      focus: session.focus || null,
      notes: session.notes || null,
      estimated_duration_minutes: session.estimatedDurationMinutes || null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to add session: ${error.message}`);

  return mapSessionRow(data, []);
};

// Delete session
export const deleteSession = async (sessionId: string): Promise<void> => {
  const { error } = await (supabaseAdmin as any).from("training_sessions").delete().eq("id", sessionId);

  if (error) throw new Error(`Failed to delete session: ${error.message}`);
};

// Update exercise
export const updateExercise = async (
  exerciseId: string,
  updates: UpdateExerciseRequest
): Promise<TrainingExercise> => {
  const updateData: any = { updated_at: new Date().toISOString() };

  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.sets !== undefined) updateData.sets = updates.sets;
  if (updates.repsMin !== undefined) updateData.reps_min = updates.repsMin;
  if (updates.repsMax !== undefined) updateData.reps_max = updates.repsMax;
  if (updates.repsTarget !== undefined) updateData.reps_target = updates.repsTarget;
  if (updates.rpeTarget !== undefined) updateData.rpe_target = updates.rpeTarget;
  if (updates.percentage1rm !== undefined) updateData.percentage_1rm = updates.percentage1rm;
  if (updates.tempo !== undefined) updateData.tempo = updates.tempo;
  if (updates.restSeconds !== undefined) updateData.rest_seconds = updates.restSeconds;
  if (updates.notes !== undefined) updateData.notes = updates.notes;
  if (updates.supersetGroup !== undefined) updateData.superset_group = updates.supersetGroup;
  if (updates.isWarmup !== undefined) updateData.is_warmup = updates.isWarmup;

  const { data, error } = await (supabaseAdmin as any)
    .from("training_exercises")
    .update(updateData)
    .eq("id", exerciseId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update exercise: ${error.message}`);

  return mapExerciseRow(data);
};

// Add exercise to session
export const addExercise = async (
  sessionId: string,
  exercise: AddExerciseRequest
): Promise<TrainingExercise> => {
  // Get max order index
  const { data: existingExercises } = await (supabaseAdmin as any)
    .from("training_exercises")
    .select("order_index")
    .eq("session_id", sessionId)
    .order("order_index", { ascending: false })
    .limit(1);

  const nextOrderIndex = existingExercises?.[0]?.order_index !== undefined
    ? existingExercises[0].order_index + 1
    : 0;

  const { data, error } = await (supabaseAdmin as any)
    .from("training_exercises")
    .insert({
      session_id: sessionId,
      name: exercise.name,
      order_index: nextOrderIndex,
      sets: exercise.sets,
      reps_min: exercise.repsMin || null,
      reps_max: exercise.repsMax || null,
      reps_target: exercise.repsTarget || null,
      rpe_target: exercise.rpeTarget || null,
      percentage_1rm: exercise.percentage1rm || null,
      tempo: exercise.tempo || null,
      rest_seconds: exercise.restSeconds || null,
      notes: exercise.notes || null,
      superset_group: exercise.supersetGroup || null,
      is_warmup: exercise.isWarmup || false,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to add exercise: ${error.message}`);

  return mapExerciseRow(data);
};

// Delete exercise
export const deleteExercise = async (exerciseId: string): Promise<void> => {
  const { error } = await (supabaseAdmin as any).from("training_exercises").delete().eq("id", exerciseId);

  if (error) throw new Error(`Failed to delete exercise: ${error.message}`);
};

// Replace all exercises for a session
export const replaceSessionExercises = async (
  sessionId: string,
  exercises: AddExerciseRequest[]
): Promise<TrainingExercise[]> => {
  // Delete existing exercises
  const { error: deleteError } = await (supabaseAdmin as any)
    .from("training_exercises")
    .delete()
    .eq("session_id", sessionId);

  if (deleteError) throw new Error(`Failed to delete existing exercises: ${deleteError.message}`);

  // Insert new exercises
  const newExercises: TrainingExercise[] = [];
  for (let i = 0; i < exercises.length; i++) {
    const exercise = exercises[i];
    const { data, error } = await (supabaseAdmin as any)
      .from("training_exercises")
      .insert({
        session_id: sessionId,
        name: exercise.name,
        order_index: i,
        sets: exercise.sets,
        reps_min: exercise.repsMin || null,
        reps_max: exercise.repsMax || null,
        reps_target: exercise.repsTarget || null,
        rpe_target: exercise.rpeTarget || null,
        percentage_1rm: exercise.percentage1rm || null,
        tempo: exercise.tempo || null,
        rest_seconds: exercise.restSeconds || null,
        notes: exercise.notes || null,
        superset_group: exercise.supersetGroup || null,
        is_warmup: exercise.isWarmup || false,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to insert exercise: ${error.message}`);
    newExercises.push(mapExerciseRow(data));
  }

  return newExercises;
};

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
  const { error } = await (supabaseAdmin as any).from("training_plan_history").insert({
    client_id: clientId,
    plan_id: planId,
    coach_prompt: coachPrompt,
    ai_response_raw: aiResponseRaw,
    plan_snapshot: plan as any,
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
  } as any);

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

  return (data || []).map((row: any) => ({
    id: row.id,
    clientId: row.client_id,
    planId: row.plan_id,
    coachPrompt: row.coach_prompt,
    aiResponseRaw: row.ai_response_raw,
    planSnapshot: row.plan_snapshot,
    clientMetricsSnapshot: row.client_metrics_snapshot,
    checkInDataSnapshot: row.check_in_data_snapshot,
    regenerationReason: row.regeneration_reason,
    createdByCoachId: row.created_by_coach_id,
    createdAt: row.created_at,
  }));
};

// Bulk reorder sessions (update day and order in batch)
export const reorderSessions = async (
  planId: string,
  updates: ReorderSessionItem[]
): Promise<void> => {
  const timestamp = new Date().toISOString();

  // Update each session's day and order
  for (const update of updates) {
    const { error } = await (supabaseAdmin as any)
      .from("training_sessions")
      .update({
        day_of_week: update.dayOfWeek,
        order_index: update.orderIndex,
        updated_at: timestamp,
      })
      .eq("id", update.sessionId)
      .eq("plan_id", planId);

    if (error) {
      throw new Error(`Failed to reorder session ${update.sessionId}: ${error.message}`);
    }
  }
};

// Update session estimated calories
export const updateSessionCalories = async (
  sessionId: string,
  estimatedCalories: number
): Promise<void> => {
  const { error } = await (supabaseAdmin as any)
    .from("training_sessions")
    .update({
      estimated_calories: estimatedCalories,
      calories_calculated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  if (error) {
    throw new Error(`Failed to update session calories: ${error.message}`);
  }
};

// Get session with exercises by ID
export const getSessionWithExercises = async (
  sessionId: string
): Promise<TrainingSession | null> => {
  const { data: sessionRow, error: sessionError } = await supabaseAdmin
    .from("training_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();

  if (sessionError || !sessionRow) return null;

  const { data: exerciseRows } = await supabaseAdmin
    .from("training_exercises")
    .select("*")
    .eq("session_id", sessionId)
    .order("order_index", { ascending: true });

  return mapSessionRow(
    sessionRow as any,
    ((exerciseRows as any[]) || []).map(mapExerciseRow)
  );
};
