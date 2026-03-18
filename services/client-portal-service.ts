import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Client, CheckIn, DietType, DayCalorieOverrides, UnitPreference } from "@/types/check-in";
import type { TrainingPlan, TrainingSession, TrainingExercise, SessionType } from "@/types/training";
import type { ActivityMetadata } from "@/types/external-activity";
import type { TrainingSessionRow, TrainingExerciseRow, ClientSessionCompletionRow } from "@/lib/database-helpers";
import type { DailyNutritionTargets } from "@/utils/nutrition-helpers";
import { getWeeklyNutritionTargets, applyDayOverrides, calculateDailyMacros, DAYS_OF_WEEK } from "@/utils/nutrition-helpers";
import type { DayOfWeek } from "@/utils/nutrition-helpers";
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
    .eq("active", true)
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

  // Read include_activity_burn and unit_preference from clients (display prefs stay on clients)
  const { data: clientData, error: clientError } = await supabase
    .from("clients")
    .select("include_activity_burn, unit_preference")
    .eq("id", clientId)
    .single();

  if (clientError || !clientData) return null;

  const includeActivityBurn = clientData.include_activity_burn ?? true;

  // Read active nutrition plan from new tables
  const { data: plan, error: planError } = await supabase
    .from("nutrition_plans")
    .select("*")
    .eq("client_id", clientId)
    .eq("status", "active")
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (planError || !plan) return null;

  // Fetch daily targets for this plan
  const { data: dailyTargetRows, error: dtError } = await supabase
    .from("nutrition_plan_daily_targets")
    .select("*")
    .eq("nutrition_plan_id", plan.id);

  if (dtError) return null;

  // Fetch the real training plan for live training calorie additions
  const trainingPlan = await getClientTrainingPlan(clientId);

  // Build DailyNutritionTargets from the stored daily targets + live training data
  const { getTrainingSessionCaloriesByDay, getTrainingSessionsSummary } = await import("@/utils/training-calorie-helpers");
  const { getExternalActivitiesForDay, calculateExternalActivityCalories, getExternalActivitiesSummary } = await import("@/utils/nutrition-helpers");

  const trainingSessionCaloriesByDay = getTrainingSessionCaloriesByDay(trainingPlan);

  // Index stored targets by day
  const targetsByDay = new Map(
    (dailyTargetRows || []).map((dt) => [dt.day_of_week, dt])
  );

  let dailyTargets: DailyNutritionTargets[] = DAYS_OF_WEEK.map((day) => {
    const stored = targetsByDay.get(day);
    const baselineCalories = stored?.calories ?? plan.baseline_calories;
    const proteinG = stored?.protein_g ?? plan.protein_target_g;
    const carbG = stored?.carb_g ?? plan.carb_target_g;
    const fatG = stored?.fat_g ?? plan.fat_target_g;
    const isTrainingDay = stored?.is_training_day ?? false;

    // Live training session calories
    const trainingSessionCalories = trainingSessionCaloriesByDay[day] || 0;
    const trainingSessions = getTrainingSessionsSummary(trainingPlan, day);

    // Live external activity calories
    const dayActivities = getExternalActivitiesForDay(trainingPlan, day);
    const externalActivityCalories = calculateExternalActivityCalories(dayActivities);
    const externalActivities = getExternalActivitiesSummary(dayActivities);

    // Total = stored baseline + live training + live external activities
    const totalActivityCalories = trainingSessionCalories + externalActivityCalories;
    const dayCalories = baselineCalories + totalActivityCalories;

    const totalCal = proteinG * 4 + carbG * 4 + fatG * 9;
    const proteinPercent = totalCal > 0 ? Math.round((proteinG * 4 / totalCal) * 100) : 0;
    const carbsPercent = totalCal > 0 ? Math.round((carbG * 4 / totalCal) * 100) : 0;

    return {
      day,
      dayLabel: day.charAt(0).toUpperCase() + day.slice(1),
      isTrainingDay,
      calories: dayCalories,
      baselineCalories,
      proteinG,
      carbsG: carbG,
      fatG,
      proteinPercent,
      carbsPercent,
      fatPercent: 100 - proteinPercent - carbsPercent,
      trainingSessionCalories,
      trainingSessions,
      externalActivityCalories,
      externalActivities,
      totalCaloriesWithActivities: dayCalories,
      includeActivityBurn,
    };
  });

  // When activity burn is excluded, flatten calories to baseline
  if (!includeActivityBurn) {
    const dietType = (plan.diet_type as DietType) || "balanced";
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

  return {
    calorieTarget: plan.custom_macros_enabled && plan.custom_calories ? plan.custom_calories : plan.baseline_calories,
    proteinTargetG: plan.protein_target_g,
    carbTargetG: plan.carb_target_g,
    fatTargetG: plan.fat_target_g,
    customMacrosEnabled: plan.custom_macros_enabled,
    customCalories: plan.custom_calories,
    customProteinG: plan.custom_protein_g,
    customCarbG: plan.custom_carb_g,
    customFatG: plan.custom_fat_g,
    dietType: plan.diet_type,
    unitPreference: clientData.unit_preference,
    baselineCalories: plan.baseline_calories,
    includeActivityBurn,
    customDayDistribution: false, // No longer needed — daily targets rows ARE the distribution
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
