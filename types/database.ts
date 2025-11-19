// Supabase database types
// These types can be auto-generated using: supabase gen types typescript --local

import type {
  CheckIn,
  CheckInToken,
  CheckInReminder,
  AIInsight,
  AIRecommendation,
} from "./check-in";

export type Database = {
  public: {
    Tables: {
      check_ins: {
        Row: {
          id: string;
          client_id: string;
          status: "pending" | "ai_processed" | "reviewed";
          mood: number | null;
          energy: number | null;
          sleep: number | null;
          stress: number | null;
          notes: string | null;
          weight: number | null;
          weight_unit: "lbs" | "kg" | null;
          body_fat_percentage: number | null;
          waist: number | null;
          hips: number | null;
          chest: number | null;
          arms: number | null;
          thighs: number | null;
          measurement_unit: "in" | "cm" | null;
          photo_front: string | null;
          photo_side: string | null;
          photo_back: string | null;
          workouts_completed: number | null;
          adherence_percentage: number | null;
          prs: string | null;
          challenges: string | null;
          ai_summary: string | null;
          ai_insights: any | null;
          ai_recommendations: any | null;
          ai_response_draft: string | null;
          ai_processed_at: string | null;
          coach_response: string | null;
          coach_reviewed_at: string | null;
          response_sent_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          status?: "pending" | "ai_processed" | "reviewed";
          mood?: number | null;
          energy?: number | null;
          sleep?: number | null;
          stress?: number | null;
          notes?: string | null;
          weight?: number | null;
          weight_unit?: "lbs" | "kg" | null;
          body_fat_percentage?: number | null;
          waist?: number | null;
          hips?: number | null;
          chest?: number | null;
          arms?: number | null;
          thighs?: number | null;
          measurement_unit?: "in" | "cm" | null;
          photo_front?: string | null;
          photo_side?: string | null;
          photo_back?: string | null;
          workouts_completed?: number | null;
          adherence_percentage?: number | null;
          prs?: string | null;
          challenges?: string | null;
          ai_summary?: string | null;
          ai_insights?: any | null;
          ai_recommendations?: any | null;
          ai_response_draft?: string | null;
          ai_processed_at?: string | null;
          coach_response?: string | null;
          coach_reviewed_at?: string | null;
          response_sent_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          status?: "pending" | "ai_processed" | "reviewed";
          mood?: number | null;
          energy?: number | null;
          sleep?: number | null;
          stress?: number | null;
          notes?: string | null;
          weight?: number | null;
          weight_unit?: "lbs" | "kg" | null;
          body_fat_percentage?: number | null;
          waist?: number | null;
          hips?: number | null;
          chest?: number | null;
          arms?: number | null;
          thighs?: number | null;
          measurement_unit?: "in" | "cm" | null;
          photo_front?: string | null;
          photo_side?: string | null;
          photo_back?: string | null;
          workouts_completed?: number | null;
          adherence_percentage?: number | null;
          prs?: string | null;
          challenges?: string | null;
          ai_summary?: string | null;
          ai_insights?: any | null;
          ai_recommendations?: any | null;
          ai_response_draft?: string | null;
          ai_processed_at?: string | null;
          coach_response?: string | null;
          coach_reviewed_at?: string | null;
          response_sent_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      check_in_tokens: {
        Row: {
          id: string;
          client_id: string;
          token: string;
          expires_at: string;
          used_at: string | null;
          check_in_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          token: string;
          expires_at: string;
          used_at?: string | null;
          check_in_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          token?: string;
          expires_at?: string;
          used_at?: string | null;
          check_in_id?: string | null;
          created_at?: string;
        };
      };
      coaches: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          email: string;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          email: string;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          email?: string;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      clients: {
        Row: {
          id: string;
          coach_id: string;
          name: string;
          email: string;
          avatar_url: string | null;
          active: boolean;
          date_of_birth: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          coach_id: string;
          name: string;
          email: string;
          avatar_url?: string | null;
          active?: boolean;
          date_of_birth?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          coach_id?: string;
          name?: string;
          email?: string;
          avatar_url?: string | null;
          active?: boolean;
          date_of_birth?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
  };
};

// Type aliases for better readability
export type CheckInRow = Database["public"]["Tables"]["check_ins"]["Row"];
export type CheckInTokenRow = Database["public"]["Tables"]["check_in_tokens"]["Row"];

/**
 * Maps a database row from check_ins table to CheckIn type
 * Converts snake_case database fields to camelCase application fields
 */
export function mapCheckInFromDatabase(row: CheckInRow): CheckIn {
  return {
    id: row.id,
    clientId: row.client_id,
    status: row.status,

    // Subjective
    mood: row.mood ?? undefined,
    energy: row.energy ?? undefined,
    sleep: row.sleep ?? undefined,
    stress: row.stress ?? undefined,
    notes: row.notes ?? undefined,

    // Body metrics
    weight: row.weight ?? undefined,
    weightUnit: row.weight_unit ?? undefined,
    bodyFatPercentage: row.body_fat_percentage ?? undefined,
    waist: row.waist ?? undefined,
    hips: row.hips ?? undefined,
    chest: row.chest ?? undefined,
    arms: row.arms ?? undefined,
    thighs: row.thighs ?? undefined,
    measurementUnit: row.measurement_unit ?? undefined,

    // Photos
    photoFront: row.photo_front ?? undefined,
    photoSide: row.photo_side ?? undefined,
    photoBack: row.photo_back ?? undefined,

    // Training & nutrition
    workoutsCompleted: row.workouts_completed ?? undefined,
    adherencePercentage: row.adherence_percentage ?? undefined,
    prs: row.prs ?? undefined,
    challenges: row.challenges ?? undefined,

    // AI fields - properly type the JSON fields
    aiSummary: row.ai_summary ?? undefined,
    aiInsights: (row.ai_insights as AIInsight[] | null) ?? undefined,
    aiRecommendations: (row.ai_recommendations as AIRecommendation[] | null) ?? undefined,
    aiResponseDraft: row.ai_response_draft ?? undefined,
    aiProcessedAt: row.ai_processed_at ?? undefined,

    // Coach response
    coachResponse: row.coach_response ?? undefined,
    coachReviewedAt: row.coach_reviewed_at ?? undefined,
    responseSentAt: row.response_sent_at ?? undefined,

    // Timestamps
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Maps a database row from check_in_tokens table to CheckInToken type
 * Converts snake_case database fields to camelCase application fields
 */
export function mapCheckInTokenFromDatabase(row: CheckInTokenRow): CheckInToken {
  return {
    id: row.id,
    clientId: row.client_id,
    token: row.token,
    expiresAt: row.expires_at,
    usedAt: row.used_at ?? undefined,
    checkInId: row.check_in_id ?? undefined,
    createdAt: row.created_at,
  };
}
