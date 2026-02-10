import type { CheckIn, AIInsight, AIRecommendation } from "@/types/check-in";
import type { CheckInRow } from "./database-helpers";

/**
 * Map a database check-in row to a CheckIn type
 */
export function mapCheckInFromDatabase(row: CheckInRow): CheckIn {
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