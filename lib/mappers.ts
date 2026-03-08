import type { CheckIn, Client, AIInsight, AIRecommendation } from "@/types/check-in";
import type { CheckInRow, ClientRow } from "./database-helpers";

/**
 * Map a database check-in row to a CheckIn type
 */
export function mapCheckInRow(row: CheckInRow): CheckIn {
  return {
    id: row.id,
    clientId: row.client_id,
    status: row.status as "pending" | "ai_processed" | "reviewed",
    mood: row.mood ?? undefined,
    energy: row.energy ?? undefined,
    sleep: row.sleep ?? undefined,
    stress: row.stress ?? undefined,
    notes: row.notes ?? undefined,
    weight: row.weight ?? undefined,
    weightUnit: row.weight_unit as "lbs" | "kg" | undefined,
    bodyFatPercentage: row.body_fat_percentage ?? undefined,
    waist: row.waist ?? undefined,
    hips: row.hips ?? undefined,
    chest: row.chest ?? undefined,
    arms: row.arms ?? undefined,
    thighs: row.thighs ?? undefined,
    measurementUnit: row.measurement_unit as "in" | "cm" | undefined,
    photoFront: row.photo_front ?? undefined,
    photoSide: row.photo_side ?? undefined,
    photoBack: row.photo_back ?? undefined,
    workoutsCompleted: row.workouts_completed ?? undefined,
    adherencePercentage: row.adherence_percentage ?? undefined,
    prs: row.prs ?? undefined,
    challenges: row.challenges ?? undefined,
    nutritionDaysOnTarget: row.nutrition_days_on_target ?? undefined,
    nutritionNotes: row.nutrition_notes ?? undefined,
    aiSummary: row.ai_summary ?? undefined,
    aiInsights: (row.ai_insights ?? undefined) as AIInsight[] | undefined,
    aiRecommendations: (row.ai_recommendations ?? undefined) as AIRecommendation[] | undefined,
    aiResponseDraft: row.ai_response_draft ?? undefined,
    aiProcessedAt: row.ai_processed_at ?? undefined,
    coachResponse: row.coach_response ?? undefined,
    coachReviewedAt: row.coach_reviewed_at ?? undefined,
    responseSentAt: row.response_sent_at ?? undefined,
    createdAt: row.created_at ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? new Date().toISOString(),
  };
}

/**
 * Map a database client row to a Client type
 */
export function mapClientRow(row: ClientRow): Client {
  return {
    id: row.id,
    coachId: row.coach_id,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatar_url ?? undefined,
    notes: row.notes ?? undefined,
    active: row.active ?? true,
    createdAt: row.created_at ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? new Date().toISOString(),
    height: row.height ?? undefined,
    heightUnit: (row.height_unit ?? undefined) as "in" | "cm" | undefined,
    gender: (row.gender ?? undefined) as "male" | "female" | "other" | undefined,
    dateOfBirth: row.date_of_birth ?? undefined,
    goalWeight: row.goal_weight ?? undefined,
    goalBodyFatPercentage: row.goal_body_fat_percentage ?? undefined,
    weightUnit: (row.weight_unit ?? "lbs") as "lbs" | "kg",
    currentWeight: row.current_weight ?? undefined,
    currentBodyFatPercentage: row.current_body_fat_percentage ?? undefined,
    bmr: row.bmr ?? undefined,
    tdee: row.tdee ?? undefined,
    checkInFrequency: (row.check_in_frequency ?? "weekly") as "weekly" | "biweekly" | "monthly" | "none",
    checkInFrequencyDays: row.check_in_frequency_days ?? undefined,
    expectedCheckInDay: (row.expected_check_in_day ?? undefined) as "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday" | undefined,
    lastReminderSentAt: row.last_reminder_sent_at ?? undefined,
    reminderPreferences: (row.reminder_preferences ?? undefined) as any,
    totalCheckInsExpected: row.total_check_ins_expected ?? undefined,
    totalCheckInsCompleted: row.total_check_ins_completed ?? undefined,
    checkInAdherenceRate: row.check_in_adherence_rate ?? undefined,
    currentStreak: row.current_streak ?? undefined,
    longestStreak: row.longest_streak ?? undefined,
    // Nutrition fields
    unitPreference: (row.unit_preference ?? "imperial") as "metric" | "imperial",
    workActivityLevel: (row.work_activity_level ?? undefined) as "sedentary" | "lightly_active" | "moderately_active" | "very_active" | "extremely_active" | undefined,
    trainingVolumeHours: (row.training_volume_hours ?? undefined) as "0-1" | "2-3" | "4-5" | "6-7" | "8+" | undefined,
    proteinTargetGPerKg: row.protein_target_g_per_kg ?? undefined,
    dietType: (row.diet_type ?? undefined) as "balanced" | "high_carb" | "low_carb" | "keto" | "custom" | undefined,
    goalDeadline: row.goal_deadline ?? undefined,
    nutritionPlanCreatedDate: row.nutrition_plan_created_date ?? undefined,
    nutritionPlanBaseWeightKg: row.nutrition_plan_base_weight_kg ?? undefined,
    baselineCalories: row.baseline_calories ?? undefined,
    startingWeight: row.starting_weight ?? undefined,
    startingBodyFatPercentage: row.starting_body_fat_percentage ?? undefined,
    calorieTarget: row.calorie_target ?? undefined,
    proteinTargetG: row.protein_target_g ?? undefined,
    carbTargetG: row.carb_target_g ?? undefined,
    fatTargetG: row.fat_target_g ?? undefined,
    includeActivityBurn: row.include_activity_burn ?? true,
    customMacrosEnabled: row.custom_macros_enabled ?? false,
    customProteinG: row.custom_protein_g ?? undefined,
    customCarbG: row.custom_carb_g ?? undefined,
    customFatG: row.custom_fat_g ?? undefined,
    customCalories: row.custom_calories ?? undefined,
    bmrManualOverride: row.bmr_manual_override ?? undefined,
    tdeeManualOverride: row.tdee_manual_override ?? undefined,
  };
}

// Legacy alias for backward compatibility
export const mapCheckInFromDatabase = mapCheckInRow;