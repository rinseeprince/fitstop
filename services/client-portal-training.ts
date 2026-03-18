import type { TrainingPlan, TrainingSession, TrainingExercise, SessionType } from "@/types/training";
import type { ActivityMetadata } from "@/types/external-activity";
import type { TrainingSessionRow, TrainingExerciseRow, ClientSessionCompletionRow } from "@/lib/database-helpers";
import { createPortalClient } from "./client-portal-service";

// Session completion type
export type SessionCompletion = {
  id: string;
  clientId: string;
  trainingSessionId: string;
  completedAt: string;
  completionQuality: "full" | "partial" | "skipped";
  notes?: string;
  weekStartDate: string;
  createdAt: string;
  updatedAt: string;
};

// Get active training plan for a client
export async function getClientTrainingPlan(
  clientId: string
): Promise<TrainingPlan | null> {
  const supabase = await createPortalClient();

  // Verify the authenticated user owns this client record
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: clientRecord } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .eq("user_id", user.id)
    .single();

  if (!clientRecord) return null;

  const { data: planData, error: planError } = await supabase
    .from("training_plans")
    .select(`
      *,
      training_sessions(
        *,
        training_exercises(*)
      )
    `)
    .eq("client_id", clientId)
    .eq("status", "active")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (planError || !planData) return null;

  type SessionRowWithExercises = TrainingSessionRow & { training_exercises: TrainingExerciseRow[] };

  // Sort sessions by order_index
  const sessionList = ((planData.training_sessions || []) as SessionRowWithExercises[]).sort(
    (a, b) => a.order_index - b.order_index
  );

  // Map sessions and exercises to the expected format
  const sessions: TrainingSession[] = sessionList.map((session) => {
    // Sort exercises by order_index within each session
    const exerciseList = (session.training_exercises || []).sort(
      (a, b) => a.order_index - b.order_index
    );

    const exercises: TrainingExercise[] = exerciseList.map((ex) => ({
      id: ex.id,
      sessionId: ex.session_id,
      name: ex.name,
      orderIndex: ex.order_index,
      sets: ex.sets,
      repsMin: ex.reps_min ?? undefined,
      repsMax: ex.reps_max ?? undefined,
      repsTarget: ex.reps_target ?? undefined,
      rpeTarget: ex.rpe_target ?? undefined,
      percentage1rm: ex.percentage_1rm ?? undefined,
      tempo: ex.tempo ?? undefined,
      restSeconds: ex.rest_seconds ?? undefined,
      notes: ex.notes ?? undefined,
      supersetGroup: ex.superset_group ?? undefined,
      isWarmup: ex.is_warmup ?? false,
      createdAt: ex.created_at,
      updatedAt: ex.updated_at,
    }));

    return {
      id: session.id,
      planId: session.plan_id,
      name: session.name,
      dayOfWeek: session.day_of_week ?? undefined,
      orderIndex: session.order_index,
      focus: session.focus ?? undefined,
      notes: session.notes ?? undefined,
      estimatedDurationMinutes: session.estimated_duration_minutes ?? undefined,
      sessionType: (session.session_type || "training") as SessionType,
      activityMetadata: (session.activity_metadata as ActivityMetadata) ?? undefined,
      estimatedCalories: session.estimated_calories ?? undefined,
      caloriesCalculatedAt: session.calories_calculated_at ?? undefined,
      exercises,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
    };
  });

  return {
    id: planData.id,
    clientId: planData.client_id,
    coachId: planData.coach_id,
    name: planData.name,
    description: planData.description,
    status: planData.status,
    coachPrompt: planData.coach_prompt,
    aiResponseRaw: planData.ai_response_raw,
    splitType: planData.split_type,
    frequencyPerWeek: planData.frequency_per_week,
    programDurationWeeks: planData.program_duration_weeks,
    clientWeightKg: planData.client_weight_kg,
    clientBodyFatPercentage: planData.client_body_fat_percentage,
    clientGoalWeightKg: planData.client_goal_weight_kg,
    clientTdee: planData.client_tdee,
    avgMood: planData.avg_mood,
    avgEnergy: planData.avg_energy,
    avgSleep: planData.avg_sleep,
    avgStress: planData.avg_stress,
    recentAdherencePercentage: planData.recent_adherence_percentage,
    sessions,
    createdAt: planData.created_at,
    updatedAt: planData.updated_at,
    deletedAt: planData.deleted_at,
  };
}

// Get weekly session completions
export async function getWeeklyCompletions(
  clientId: string,
  weekStartDate: string
): Promise<SessionCompletion[]> {
  const supabase = await createPortalClient();

  const { data, error } = await supabase
    .from("client_session_completions")
    .select("*")
    .eq("client_id", clientId)
    .eq("week_start_date", weekStartDate);

  if (error || !data) return [];

  return data.map((row: ClientSessionCompletionRow) => ({
    id: row.id,
    clientId: row.client_id,
    trainingSessionId: row.training_session_id,
    completedAt: row.completed_at,
    completionQuality: (row.completion_quality ?? "full") as SessionCompletion["completionQuality"],
    notes: row.notes ?? undefined,
    weekStartDate: row.week_start_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

// Mark a session as complete
export async function markSessionComplete(
  clientId: string,
  trainingSessionId: string,
  weekStartDate: string,
  quality: "full" | "partial" | "skipped" = "full",
  notes?: string
): Promise<SessionCompletion | null> {
  const supabase = await createPortalClient();

  const { data, error } = await supabase
    .from("client_session_completions")
    .upsert(
      {
        client_id: clientId,
        training_session_id: trainingSessionId,
        week_start_date: weekStartDate,
        completion_quality: quality,
        notes,
        completed_at: new Date().toISOString(),
      },
      {
        onConflict: "client_id,training_session_id,week_start_date",
      }
    )
    .select()
    .single();

  if (error || !data) return null;

  return {
    id: data.id,
    clientId: data.client_id,
    trainingSessionId: data.training_session_id,
    completedAt: data.completed_at,
    completionQuality: data.completion_quality,
    notes: data.notes,
    weekStartDate: data.week_start_date,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

// Remove session completion (unmark as complete)
export async function removeSessionCompletion(
  clientId: string,
  trainingSessionId: string,
  weekStartDate: string
): Promise<boolean> {
  const supabase = await createPortalClient();

  const { error } = await supabase
    .from("client_session_completions")
    .delete()
    .eq("client_id", clientId)
    .eq("training_session_id", trainingSessionId)
    .eq("week_start_date", weekStartDate);

  return !error;
}

// Get the start of the current week (Monday)
export function getCurrentWeekStart(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.setDate(diff));
  return monday.toISOString().split("T")[0];
}
