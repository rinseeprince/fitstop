import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Client, CheckIn } from "@/types/check-in";
import type { TrainingPlan, TrainingSession, TrainingExercise } from "@/types/training";
import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";
import { getWeeklyNutritionTargets } from "@/utils/nutrition-helpers";

// Create authenticated Supabase client for server-side client portal access
// Uses regular client (not admin) to respect RLS policies
async function createPortalClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Handle read-only error in Server Components
          }
        },
      },
    }
  );
}

// Nutrition targets type
export type NutritionTargets = {
  calorieTarget?: number;
  proteinTargetG?: number;
  carbTargetG?: number;
  fatTargetG?: number;
  customMacrosEnabled?: boolean;
  customCalories?: number;
  customProteinG?: number;
  customCarbG?: number;
  customFatG?: number;
  dietType?: string;
  unitPreference?: string;
  baselineCalories?: number;
  dailyTargets?: DailyNutritionTargets[];
};

// Progress data for charts
export type ProgressDataPoint = {
  date: string;
  weight?: number;
  bodyFatPercentage?: number;
};

export type ProgressData = {
  weightHistory: ProgressDataPoint[];
  bodyFatHistory: ProgressDataPoint[];
  checkInCount: number;
  currentStreak: number;
  adherenceRate: number;
};

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

// Helper to map database row to Client type
function mapRowToClient(row: any): Client {
  return {
    id: row.id,
    coachId: row.coach_id,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatar_url,
    notes: row.notes,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    height: row.height,
    heightUnit: row.height_unit,
    gender: row.gender,
    dateOfBirth: row.date_of_birth,
    goalWeight: row.goal_weight,
    goalBodyFatPercentage: row.goal_body_fat_percentage,
    weightUnit: row.weight_unit,
    currentWeight: row.current_weight,
    currentBodyFatPercentage: row.current_body_fat_percentage,
    bmr: row.bmr,
    tdee: row.tdee,
    checkInFrequency: row.check_in_frequency,
    checkInFrequencyDays: row.check_in_frequency_days,
    expectedCheckInDay: row.expected_check_in_day,
    totalCheckInsExpected: row.total_check_ins_expected,
    totalCheckInsCompleted: row.total_check_ins_completed,
    checkInAdherenceRate: row.check_in_adherence_rate,
    currentStreak: row.current_streak,
    longestStreak: row.longest_streak,
    unitPreference: row.unit_preference,
    workActivityLevel: row.work_activity_level,
    trainingVolumeHours: row.training_volume_hours,
    proteinTargetGPerKg: row.protein_target_g_per_kg,
    dietType: row.diet_type,
    goalDeadline: row.goal_deadline,
    nutritionPlanCreatedDate: row.nutrition_plan_created_date,
    nutritionPlanBaseWeightKg: row.nutrition_plan_base_weight_kg,
    baselineCalories: row.baseline_calories,
    startingWeight: row.starting_weight,
    startingBodyFatPercentage: row.starting_body_fat_percentage,
    calorieTarget: row.calorie_target,
    proteinTargetG: row.protein_target_g,
    carbTargetG: row.carb_target_g,
    fatTargetG: row.fat_target_g,
    customMacrosEnabled: row.custom_macros_enabled,
    customProteinG: row.custom_protein_g,
    customCarbG: row.custom_carb_g,
    customFatG: row.custom_fat_g,
    bmrManualOverride: row.bmr_manual_override,
    tdeeManualOverride: row.tdee_manual_override,
  };
}

// Helper to map database row to CheckIn type
function mapRowToCheckIn(row: any): CheckIn {
  return {
    id: row.id,
    clientId: row.client_id,
    status: row.status,
    mood: row.mood,
    energy: row.energy,
    sleep: row.sleep,
    stress: row.stress,
    notes: row.notes,
    weight: row.weight,
    weightUnit: row.weight_unit,
    bodyFatPercentage: row.body_fat_percentage,
    waist: row.waist,
    hips: row.hips,
    chest: row.chest,
    arms: row.arms,
    thighs: row.thighs,
    measurementUnit: row.measurement_unit,
    photoFront: row.photo_front,
    photoSide: row.photo_side,
    photoBack: row.photo_back,
    workoutsCompleted: row.workouts_completed,
    adherencePercentage: row.adherence_percentage,
    prs: row.prs,
    challenges: row.challenges,
    aiSummary: row.ai_summary,
    aiInsights: row.ai_insights,
    aiRecommendations: row.ai_recommendations,
    aiResponseDraft: row.ai_response_draft,
    aiProcessedAt: row.ai_processed_at,
    coachResponse: row.coach_response,
    coachReviewedAt: row.coach_reviewed_at,
    responseSentAt: row.response_sent_at,
    nutritionDaysOnTarget: row.nutrition_days_on_target,
    nutritionNotes: row.nutrition_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Get client record for the authenticated user
export async function getClientForCurrentUser(): Promise<Client | null> {
  const supabase = await createPortalClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (error || !data) return null;

  return mapRowToClient(data);
}

// Get active training plan for a client
export async function getClientTrainingPlan(
  clientId: string
): Promise<TrainingPlan | null> {
  const supabase = await createPortalClient();

  const { data: planData, error: planError } = await supabase
    .from("training_plans")
    .select("*")
    .eq("client_id", clientId)
    .eq("status", "active")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (planError || !planData) return null;

  // Fetch sessions
  const { data: sessionsData } = await supabase
    .from("training_sessions")
    .select("*")
    .eq("plan_id", planData.id)
    .order("order_index", { ascending: true });

  const sessions: TrainingSession[] = [];

  if (sessionsData) {
    for (const session of sessionsData) {
      // Fetch exercises for each session
      const { data: exercisesData } = await supabase
        .from("training_exercises")
        .select("*")
        .eq("session_id", session.id)
        .order("order_index", { ascending: true });

      const exercises: TrainingExercise[] = (exercisesData || []).map(
        (ex: any) => ({
          id: ex.id,
          sessionId: ex.session_id,
          name: ex.name,
          orderIndex: ex.order_index,
          sets: ex.sets,
          repsMin: ex.reps_min,
          repsMax: ex.reps_max,
          repsTarget: ex.reps_target,
          rpeTarget: ex.rpe_target,
          percentage1rm: ex.percentage_1rm,
          tempo: ex.tempo,
          restSeconds: ex.rest_seconds,
          notes: ex.notes,
          supersetGroup: ex.superset_group,
          isWarmup: ex.is_warmup,
          createdAt: ex.created_at,
          updatedAt: ex.updated_at,
        })
      );

      sessions.push({
        id: session.id,
        planId: session.plan_id,
        name: session.name,
        dayOfWeek: session.day_of_week,
        orderIndex: session.order_index,
        focus: session.focus,
        notes: session.notes,
        estimatedDurationMinutes: session.estimated_duration_minutes,
        sessionType: session.session_type || "training",
        activityMetadata: session.activity_metadata,
        estimatedCalories: session.estimated_calories,
        caloriesCalculatedAt: session.calories_calculated_at,
        exercises,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
      });
    }
  }

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

// Get check-in history for a client
export async function getClientCheckIns(
  clientId: string,
  options?: { limit?: number; offset?: number }
): Promise<CheckIn[]> {
  const supabase = await createPortalClient();
  const limit = options?.limit || 20;
  const offset = options?.offset || 0;

  const { data, error } = await supabase
    .from("check_ins")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error || !data) return [];

  return data.map(mapRowToCheckIn);
}

// Get a single check-in by ID
export async function getClientCheckInById(
  checkInId: string
): Promise<CheckIn | null> {
  const supabase = await createPortalClient();

  const { data, error } = await supabase
    .from("check_ins")
    .select("*")
    .eq("id", checkInId)
    .single();

  if (error || !data) return null;

  return mapRowToCheckIn(data);
}

// Get nutrition targets for a client with daily breakdown
export async function getClientNutritionTargets(
  clientId: string
): Promise<NutritionTargets | null> {
  const supabase = await createPortalClient();

  const { data, error } = await supabase
    .from("clients")
    .select(
      `calorie_target, protein_target_g, carb_target_g, fat_target_g,
       custom_macros_enabled, custom_calories, custom_protein_g, custom_carb_g, custom_fat_g,
       diet_type, unit_preference, baseline_calories`
    )
    .eq("id", clientId)
    .single();

  if (error || !data) return null;

  // Get training plan for daily targets calculation
  const trainingPlan = await getClientTrainingPlan(clientId);
  
  // Calculate daily targets if we have baseline calories and protein target
  let dailyTargets: DailyNutritionTargets[] | undefined = undefined;
  
  if (data.baseline_calories && data.protein_target_g && data.diet_type) {
    dailyTargets = getWeeklyNutritionTargets(
      data.baseline_calories,
      data.protein_target_g,
      trainingPlan,
      data.diet_type as any
    );
  }

  return {
    calorieTarget: data.calorie_target,
    proteinTargetG: data.protein_target_g,
    carbTargetG: data.carb_target_g,
    fatTargetG: data.fat_target_g,
    customMacrosEnabled: data.custom_macros_enabled,
    customCalories: data.custom_calories,
    customProteinG: data.custom_protein_g,
    customCarbG: data.custom_carb_g,
    customFatG: data.custom_fat_g,
    dietType: data.diet_type,
    unitPreference: data.unit_preference,
    baselineCalories: data.baseline_calories,
    dailyTargets,
  };
}

// Get progress data for charts
export async function getClientProgressData(
  clientId: string,
  days: number = 90
): Promise<ProgressData> {
  const supabase = await createPortalClient();

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const { data: checkIns } = await supabase
    .from("check_ins")
    .select("created_at, weight, body_fat_percentage")
    .eq("client_id", clientId)
    .gte("created_at", startDate.toISOString())
    .order("created_at", { ascending: true });

  const { data: clientData } = await supabase
    .from("clients")
    .select("current_streak, check_in_adherence_rate")
    .eq("id", clientId)
    .single();

  const weightHistory: ProgressDataPoint[] = [];
  const bodyFatHistory: ProgressDataPoint[] = [];

  if (checkIns) {
    for (const checkIn of checkIns) {
      const date = checkIn.created_at.split("T")[0];
      if (checkIn.weight) {
        weightHistory.push({ date, weight: checkIn.weight });
      }
      if (checkIn.body_fat_percentage) {
        bodyFatHistory.push({ date, bodyFatPercentage: checkIn.body_fat_percentage });
      }
    }
  }

  return {
    weightHistory,
    bodyFatHistory,
    checkInCount: checkIns?.length || 0,
    currentStreak: clientData?.current_streak || 0,
    adherenceRate: clientData?.check_in_adherence_rate || 0,
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

  return data.map((row: any) => ({
    id: row.id,
    clientId: row.client_id,
    trainingSessionId: row.training_session_id,
    completedAt: row.completed_at,
    completionQuality: row.completion_quality,
    notes: row.notes,
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
