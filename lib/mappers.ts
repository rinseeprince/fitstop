import type { CheckIn, Client, AIInsight, AIRecommendation, EnhancedAIData, ReminderPreferences } from "@/types/check-in";
import type { ClientIntake, ClientIntakeRow, OnboardingStatus } from "@/types/client-intake";
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
    aiInsights: (row.ai_insights ?? undefined) as AIInsight[] | EnhancedAIData | undefined,
    aiRecommendations: (row.ai_recommendations ?? undefined) as AIRecommendation[] | undefined,
    aiResponseDraft: row.ai_response_draft ?? undefined,
    aiProcessedAt: row.ai_processed_at ?? undefined,
    coachResponse: row.coach_response ?? undefined,
    coachReviewedAt: row.coach_reviewed_at ?? undefined,
    responseSentAt: row.response_sent_at ?? undefined,
    periodStart: row.period_start ?? undefined,
    periodEnd: row.period_end ?? undefined,
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
    reminderPreferences: (row.reminder_preferences ?? undefined) as ReminderPreferences | undefined,
    totalCheckInsExpected: row.total_check_ins_expected ?? undefined,
    totalCheckInsCompleted: row.total_check_ins_completed ?? undefined,
    checkInAdherenceRate: row.check_in_adherence_rate ?? undefined,
    currentStreak: row.current_streak ?? undefined,
    longestStreak: row.longest_streak ?? undefined,
    // Display preferences
    unitPreference: (row.unit_preference ?? "imperial") as "metric" | "imperial",
    includeActivityBurn: row.include_activity_burn ?? true,
    startingWeight: row.starting_weight ?? undefined,
    startingBodyFatPercentage: row.starting_body_fat_percentage ?? undefined,
    bmrManualOverride: row.bmr_manual_override ?? undefined,
    tdeeManualOverride: row.tdee_manual_override ?? undefined,
    welcomeMessage: row.welcome_message ?? undefined,
    onboardingStatus: (row.onboarding_status ?? undefined) as OnboardingStatus | undefined,
    walkthroughCompletedAt: row.walkthrough_completed_at ?? undefined,
    startDate: row.start_date ?? undefined,
  };
}

// Legacy alias for backward compatibility
export const mapCheckInFromDatabase = mapCheckInRow;

/**
 * Map a database client_intake row to a ClientIntake type
 */
export function mapClientIntakeRow(row: ClientIntakeRow): ClientIntake {
  return {
    id: row.id,
    clientId: row.client_id,
    status: row.status as ClientIntake["status"],
    dateOfBirth: row.date_of_birth ?? undefined,
    gender: (row.gender ?? undefined) as ClientIntake["gender"],
    height: row.height ?? undefined,
    heightUnit: (row.height_unit ?? undefined) as ClientIntake["heightUnit"],
    currentWeight: row.current_weight ?? undefined,
    weightUnit: (row.weight_unit ?? undefined) as ClientIntake["weightUnit"],
    bodyFatPercentage: row.body_fat_percentage ?? undefined,
    workActivityLevel: (row.work_activity_level ?? undefined) as ClientIntake["workActivityLevel"],
    primaryGoal: (row.primary_goal ?? undefined) as ClientIntake["primaryGoal"],
    goalDetails: row.goal_details ?? undefined,
    targetWeight: row.target_weight ?? undefined,
    goalBodyFatPercentage: row.goal_body_fat_percentage ?? undefined,
    goalDeadline: row.goal_deadline ?? undefined,
    goalDescription: row.goal_description ?? undefined,
    motivation: row.motivation ?? undefined,
    trainingExperienceLevel: (row.training_experience_level ?? undefined) as ClientIntake["trainingExperienceLevel"],
    trainingTimePreference: (row.training_time_preference ?? undefined) as ClientIntake["trainingTimePreference"],
    trainingLocation: (row.training_location ?? undefined) as ClientIntake["trainingLocation"],
    availableEquipment: row.available_equipment ?? undefined,
    daysPerWeek: row.days_per_week ?? undefined,
    sessionDurationMinutes: row.session_duration_minutes ?? undefined,
    dietaryRequirements: row.dietary_requirements ?? undefined,
    cookingFrequency: (row.cooking_frequency ?? undefined) as ClientIntake["cookingFrequency"],
    nutritionNotes: row.nutrition_notes ?? undefined,
    foodAllergies: row.food_allergies ?? undefined,
    dietDescription: row.diet_description ?? undefined,
    hasTrackedMacrosBefore: row.has_tracked_macros_before ?? undefined,
    mealsPerDay: row.meals_per_day ?? undefined,
    biggestNutritionChallenge: row.biggest_nutrition_challenge ?? undefined,
    injuriesOrLimitations: row.injuries_or_limitations ?? undefined,
    medicalNotes: row.medical_notes ?? undefined,
    previousCoachingExperience: row.previous_coaching_experience ?? undefined,
    previousCoachingDetails: row.previous_coaching_details ?? undefined,
    anythingElse: row.anything_else ?? undefined,
    reviewedAt: row.reviewed_at ?? undefined,
    reviewedBy: row.reviewed_by ?? undefined,
    coachReviewNotes: row.coach_review_notes ?? undefined,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    createdAt: row.created_at ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? new Date().toISOString(),
  };
}