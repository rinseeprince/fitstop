import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Client, CheckIn, DietType, DayCalorieOverrides, UnitPreference } from "@/types/check-in";
import type { TrainingPlan, TrainingSession, TrainingExercise, SessionType } from "@/types/training";
import type { ActivityMetadata } from "@/types/external-activity";
import type { TrainingSessionRow, TrainingExerciseRow, ClientSessionCompletionRow } from "@/lib/database-helpers";
import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";
import { getWeeklyNutritionTargets, applyDayOverrides, calculateDailyMacros } from "@/utils/nutrition-helpers";
import { mapClientRow, mapCheckInRow } from "@/lib/mappers";

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
  dietType?: DietType;
  unitPreference?: UnitPreference;
  baselineCalories?: number;
  includeActivityBurn: boolean;
  customDayDistribution?: boolean;
  dailyTargets?: DailyNutritionTargets[];
};

// Progress data for charts
export type ProgressDataPoint = {
  date: string;
  weight?: number;
  bodyFatPercentage?: number;
  waist?: number;
  hips?: number;
  chest?: number;
  arms?: number;
  thighs?: number;
  mood?: number;
  energy?: number;
  sleep?: number;
  stress?: number;
};

export type ProgressData = {
  weightHistory: ProgressDataPoint[];
  bodyFatHistory: ProgressDataPoint[];
  bodyMeasurements: {
    waistHistory: ProgressDataPoint[];
    hipsHistory: ProgressDataPoint[];
    chestHistory: ProgressDataPoint[];
    armsHistory: ProgressDataPoint[];
    thighsHistory: ProgressDataPoint[];
  };
  wellnessMetrics: {
    moodHistory: ProgressDataPoint[];
    energyHistory: ProgressDataPoint[];
    sleepHistory: ProgressDataPoint[];
    stressHistory: ProgressDataPoint[];
  };
  checkInCount: number;
  currentStreak: number;
  adherenceRate: number;
  client: {
    goalWeight?: number;
    goalBodyFatPercentage?: number;
    startingWeight?: number;
    startingBodyFatPercentage?: number;
    currentWeight?: number;
    currentBodyFatPercentage?: number;
    weightUnit?: string;
    measurementUnit?: string;
  };
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
    .eq("is_active", true)
    .single();

  if (error || !data) return null;

  return mapClientRow(data);
}

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
      isWarmup: ex.is_warmup || false,
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

  return data.map(mapCheckInRow);
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

  return mapCheckInRow(data);
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
       diet_type, unit_preference, baseline_calories, include_activity_burn,
       custom_day_distribution, day_calorie_overrides`
    )
    .eq("id", clientId)
    .single();

  if (error || !data) return null;

  const includeActivityBurn = data.include_activity_burn ?? true;

  // Always fetch the real training plan so isTrainingDay flags are preserved
  const trainingPlan = await getClientTrainingPlan(clientId);

  // Calculate daily targets if we have baseline calories and protein target
  let dailyTargets: DailyNutritionTargets[] | undefined = undefined;

  if (data.baseline_calories && data.protein_target_g && data.diet_type) {
    dailyTargets = getWeeklyNutritionTargets(
      data.baseline_calories,
      data.protein_target_g,
      trainingPlan,
      data.diet_type as DietType
    );

    // Apply custom day distribution overrides (replaces baseline per day, training still additive)
    if (data.custom_day_distribution && data.day_calorie_overrides) {
      dailyTargets = applyDayOverrides(
        dailyTargets,
        data.day_calorie_overrides as DayCalorieOverrides,
        data.diet_type as DietType
      );
    }

    // When activity burn is excluded, flatten calories to baseline and recalculate macros
    if (!includeActivityBurn) {
      const dietType = (data.diet_type as DietType) || "balanced";
      dailyTargets = dailyTargets.map((day) => {
        const macros = calculateDailyMacros(
          day.baselineCalories,
          day.proteinG,
          false,
          dietType
        );
        const totalCal = macros.proteinG * 4 + macros.carbsG * 4 + macros.fatG * 9;
        const proteinPercent = totalCal > 0 ? Math.round((macros.proteinG * 4 / totalCal) * 100) : 0;
        const carbsPercent = totalCal > 0 ? Math.round((macros.carbsG * 4 / totalCal) * 100) : 0;

        return {
          ...day,
          calories: day.baselineCalories,
          trainingSessionCalories: 0,
          externalActivityCalories: 0,
          totalCaloriesWithActivities: day.baselineCalories,
          proteinG: macros.proteinG,
          carbsG: macros.carbsG,
          fatG: macros.fatG,
          proteinPercent,
          carbsPercent,
          fatPercent: 100 - proteinPercent - carbsPercent,
        };
      });
    }
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
    includeActivityBurn,
    customDayDistribution: data.custom_day_distribution ?? false,
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
    .select(`
      created_at, 
      weight, 
      body_fat_percentage,
      waist,
      hips,
      chest,
      arms,
      thighs,
      mood,
      energy,
      sleep,
      stress
    `)
    .eq("client_id", clientId)
    .gte("created_at", startDate.toISOString())
    .order("created_at", { ascending: true });

  const { data: clientData } = await supabase
    .from("clients")
    .select(`
      current_streak, 
      check_in_adherence_rate,
      goal_weight,
      goal_body_fat_percentage,
      starting_weight,
      starting_body_fat_percentage,
      current_weight,
      current_body_fat_percentage,
      weight_unit,
      measurement_unit
    `)
    .eq("id", clientId)
    .single();

  const weightHistory: ProgressDataPoint[] = [];
  const bodyFatHistory: ProgressDataPoint[] = [];
  const waistHistory: ProgressDataPoint[] = [];
  const hipsHistory: ProgressDataPoint[] = [];
  const chestHistory: ProgressDataPoint[] = [];
  const armsHistory: ProgressDataPoint[] = [];
  const thighsHistory: ProgressDataPoint[] = [];
  const moodHistory: ProgressDataPoint[] = [];
  const energyHistory: ProgressDataPoint[] = [];
  const sleepHistory: ProgressDataPoint[] = [];
  const stressHistory: ProgressDataPoint[] = [];

  if (checkIns) {
    for (const checkIn of checkIns) {
      const date = checkIn.created_at.split("T")[0];
      
      if (checkIn.weight) {
        weightHistory.push({ date, weight: checkIn.weight });
      }
      if (checkIn.body_fat_percentage) {
        bodyFatHistory.push({ date, bodyFatPercentage: checkIn.body_fat_percentage });
      }
      if (checkIn.waist) {
        waistHistory.push({ date, waist: checkIn.waist });
      }
      if (checkIn.hips) {
        hipsHistory.push({ date, hips: checkIn.hips });
      }
      if (checkIn.chest) {
        chestHistory.push({ date, chest: checkIn.chest });
      }
      if (checkIn.arms) {
        armsHistory.push({ date, arms: checkIn.arms });
      }
      if (checkIn.thighs) {
        thighsHistory.push({ date, thighs: checkIn.thighs });
      }
      if (checkIn.mood) {
        moodHistory.push({ date, mood: checkIn.mood });
      }
      if (checkIn.energy) {
        energyHistory.push({ date, energy: checkIn.energy });
      }
      if (checkIn.sleep) {
        sleepHistory.push({ date, sleep: checkIn.sleep });
      }
      if (checkIn.stress) {
        stressHistory.push({ date, stress: checkIn.stress });
      }
    }
  }

  return {
    weightHistory,
    bodyFatHistory,
    bodyMeasurements: {
      waistHistory,
      hipsHistory,
      chestHistory,
      armsHistory,
      thighsHistory,
    },
    wellnessMetrics: {
      moodHistory,
      energyHistory,
      sleepHistory,
      stressHistory,
    },
    checkInCount: checkIns?.length || 0,
    currentStreak: clientData?.current_streak || 0,
    adherenceRate: clientData?.check_in_adherence_rate || 0,
    client: {
      goalWeight: clientData?.goal_weight,
      goalBodyFatPercentage: clientData?.goal_body_fat_percentage,
      startingWeight: clientData?.starting_weight,
      startingBodyFatPercentage: clientData?.starting_body_fat_percentage,
      currentWeight: clientData?.current_weight,
      currentBodyFatPercentage: clientData?.current_body_fat_percentage,
      weightUnit: clientData?.weight_unit,
      measurementUnit: clientData?.measurement_unit,
    },
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
