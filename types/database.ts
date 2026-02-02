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
          notes: string | null;
          active: boolean;
          height: number | null;
          height_unit: "in" | "cm" | null;
          gender: "male" | "female" | "other" | null;
          date_of_birth: string | null;
          goal_weight: number | null;
          goal_body_fat_percentage: number | null;
          weight_unit: "lbs" | "kg" | null;
          current_weight: number | null;
          current_body_fat_percentage: number | null;
          bmr: number | null;
          tdee: number | null;
          check_in_frequency: string | null;
          check_in_frequency_days: number | null;
          expected_check_in_day: string | null;
          last_reminder_sent_at: string | null;
          reminder_preferences: any | null;
          total_check_ins_expected: number | null;
          total_check_ins_completed: number | null;
          check_in_adherence_rate: number | null;
          current_streak: number | null;
          longest_streak: number | null;
          unit_preference: "metric" | "imperial" | null;
          work_activity_level: string | null;
          training_volume_hours: string | null;
          protein_target_g_per_kg: number | null;
          diet_type: string | null;
          goal_deadline: string | null;
          nutrition_plan_created_date: string | null;
          nutrition_plan_base_weight_kg: number | null;
          baseline_calories: number | null;
          starting_weight: number | null;
          starting_body_fat_percentage: number | null;
          calorie_target: number | null;
          protein_target_g: number | null;
          carb_target_g: number | null;
          fat_target_g: number | null;
          custom_macros_enabled: boolean | null;
          custom_protein_g: number | null;
          custom_carb_g: number | null;
          custom_fat_g: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          coach_id: string;
          name: string;
          email: string;
          avatar_url?: string | null;
          notes?: string | null;
          active?: boolean;
          height?: number | null;
          height_unit?: "in" | "cm" | null;
          gender?: "male" | "female" | "other" | null;
          date_of_birth?: string | null;
          goal_weight?: number | null;
          goal_body_fat_percentage?: number | null;
          weight_unit?: "lbs" | "kg" | null;
          current_weight?: number | null;
          current_body_fat_percentage?: number | null;
          bmr?: number | null;
          tdee?: number | null;
          check_in_frequency?: string | null;
          check_in_frequency_days?: number | null;
          expected_check_in_day?: string | null;
          last_reminder_sent_at?: string | null;
          reminder_preferences?: any | null;
          total_check_ins_expected?: number | null;
          total_check_ins_completed?: number | null;
          check_in_adherence_rate?: number | null;
          current_streak?: number | null;
          longest_streak?: number | null;
          unit_preference?: "metric" | "imperial" | null;
          work_activity_level?: string | null;
          training_volume_hours?: string | null;
          protein_target_g_per_kg?: number | null;
          diet_type?: string | null;
          goal_deadline?: string | null;
          nutrition_plan_created_date?: string | null;
          nutrition_plan_base_weight_kg?: number | null;
          baseline_calories?: number | null;
          starting_weight?: number | null;
          starting_body_fat_percentage?: number | null;
          calorie_target?: number | null;
          protein_target_g?: number | null;
          carb_target_g?: number | null;
          fat_target_g?: number | null;
          custom_macros_enabled?: boolean | null;
          custom_protein_g?: number | null;
          custom_carb_g?: number | null;
          custom_fat_g?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          coach_id?: string;
          name?: string;
          email?: string;
          avatar_url?: string | null;
          notes?: string | null;
          active?: boolean;
          height?: number | null;
          height_unit?: "in" | "cm" | null;
          gender?: "male" | "female" | "other" | null;
          date_of_birth?: string | null;
          goal_weight?: number | null;
          goal_body_fat_percentage?: number | null;
          weight_unit?: "lbs" | "kg" | null;
          current_weight?: number | null;
          current_body_fat_percentage?: number | null;
          bmr?: number | null;
          tdee?: number | null;
          check_in_frequency?: string | null;
          check_in_frequency_days?: number | null;
          expected_check_in_day?: string | null;
          last_reminder_sent_at?: string | null;
          reminder_preferences?: any | null;
          total_check_ins_expected?: number | null;
          total_check_ins_completed?: number | null;
          check_in_adherence_rate?: number | null;
          current_streak?: number | null;
          longest_streak?: number | null;
          unit_preference?: "metric" | "imperial" | null;
          work_activity_level?: string | null;
          training_volume_hours?: string | null;
          protein_target_g_per_kg?: number | null;
          diet_type?: string | null;
          goal_deadline?: string | null;
          nutrition_plan_created_date?: string | null;
          nutrition_plan_base_weight_kg?: number | null;
          baseline_calories?: number | null;
          starting_weight?: number | null;
          starting_body_fat_percentage?: number | null;
          calorie_target?: number | null;
          protein_target_g?: number | null;
          carb_target_g?: number | null;
          fat_target_g?: number | null;
          custom_macros_enabled?: boolean | null;
          custom_protein_g?: number | null;
          custom_carb_g?: number | null;
          custom_fat_g?: number | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      nutrition_plan_history: {
        Row: {
          id: string;
          client_id: string;
          created_at: string;
          base_weight_kg: number;
          goal_weight_kg: number | null;
          bmr: number | null;
          tdee: number | null;
          work_activity_level: string;
          training_volume_hours: string;
          protein_target_g_per_kg: number;
          diet_type: string;
          goal_deadline: string | null;
          calorie_target: number;
          protein_target_g: number;
          carb_target_g: number;
          fat_target_g: number;
          created_by_coach_id: string | null;
          regeneration_reason: string | null;
        };
        Insert: {
          id?: string;
          client_id: string;
          created_at?: string;
          base_weight_kg: number;
          goal_weight_kg?: number | null;
          bmr?: number | null;
          tdee?: number | null;
          work_activity_level: string;
          training_volume_hours: string;
          protein_target_g_per_kg: number;
          diet_type: string;
          goal_deadline?: string | null;
          calorie_target: number;
          protein_target_g: number;
          carb_target_g: number;
          fat_target_g: number;
          created_by_coach_id?: string | null;
          regeneration_reason?: string | null;
        };
        Update: {
          id?: string;
          client_id?: string;
          created_at?: string;
          base_weight_kg?: number;
          goal_weight_kg?: number | null;
          bmr?: number | null;
          tdee?: number | null;
          work_activity_level?: string;
          training_volume_hours?: string;
          protein_target_g_per_kg?: number;
          diet_type?: string;
          goal_deadline?: string | null;
          calorie_target?: number;
          protein_target_g?: number;
          carb_target_g?: number;
          fat_target_g?: number;
          created_by_coach_id?: string | null;
          regeneration_reason?: string | null;
        };
      };
      training_plans: {
        Row: {
          id: string;
          client_id: string;
          coach_id: string;
          name: string;
          description: string | null;
          status: "active" | "archived" | "draft";
          coach_prompt: string;
          ai_response_raw: string | null;
          split_type: string;
          frequency_per_week: number;
          program_duration_weeks: number | null;
          client_weight_kg: number | null;
          client_body_fat_percentage: number | null;
          client_goal_weight_kg: number | null;
          client_tdee: number | null;
          avg_mood: number | null;
          avg_energy: number | null;
          avg_sleep: number | null;
          avg_stress: number | null;
          recent_adherence_percentage: number | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          client_id: string;
          coach_id: string;
          name?: string;
          description?: string | null;
          status?: "active" | "archived" | "draft";
          coach_prompt: string;
          ai_response_raw?: string | null;
          split_type: string;
          frequency_per_week: number;
          program_duration_weeks?: number | null;
          client_weight_kg?: number | null;
          client_body_fat_percentage?: number | null;
          client_goal_weight_kg?: number | null;
          client_tdee?: number | null;
          avg_mood?: number | null;
          avg_energy?: number | null;
          avg_sleep?: number | null;
          avg_stress?: number | null;
          recent_adherence_percentage?: number | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          client_id?: string;
          coach_id?: string;
          name?: string;
          description?: string | null;
          status?: "active" | "archived" | "draft";
          coach_prompt?: string;
          ai_response_raw?: string | null;
          split_type?: string;
          frequency_per_week?: number;
          program_duration_weeks?: number | null;
          client_weight_kg?: number | null;
          client_body_fat_percentage?: number | null;
          client_goal_weight_kg?: number | null;
          client_tdee?: number | null;
          avg_mood?: number | null;
          avg_energy?: number | null;
          avg_sleep?: number | null;
          avg_stress?: number | null;
          recent_adherence_percentage?: number | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
      };
      training_sessions: {
        Row: {
          id: string;
          plan_id: string;
          name: string;
          day_of_week: string | null;
          order_index: number;
          focus: string | null;
          notes: string | null;
          estimated_duration_minutes: number | null;
          session_type: "training" | "external_activity";
          activity_metadata: Record<string, unknown> | null;
          estimated_calories: number | null;
          calories_calculated_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          plan_id: string;
          name: string;
          day_of_week?: string | null;
          order_index?: number;
          focus?: string | null;
          notes?: string | null;
          estimated_duration_minutes?: number | null;
          session_type?: "training" | "external_activity";
          activity_metadata?: Record<string, unknown> | null;
          estimated_calories?: number | null;
          calories_calculated_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          plan_id?: string;
          name?: string;
          day_of_week?: string | null;
          order_index?: number;
          focus?: string | null;
          notes?: string | null;
          estimated_duration_minutes?: number | null;
          session_type?: "training" | "external_activity";
          activity_metadata?: Record<string, unknown> | null;
          estimated_calories?: number | null;
          calories_calculated_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      training_exercises: {
        Row: {
          id: string;
          session_id: string;
          name: string;
          order_index: number;
          sets: number;
          reps_min: number | null;
          reps_max: number | null;
          reps_target: string | null;
          rpe_target: number | null;
          percentage_1rm: number | null;
          tempo: string | null;
          rest_seconds: number | null;
          notes: string | null;
          superset_group: string | null;
          is_warmup: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          name: string;
          order_index?: number;
          sets: number;
          reps_min?: number | null;
          reps_max?: number | null;
          reps_target?: string | null;
          rpe_target?: number | null;
          percentage_1rm?: number | null;
          tempo?: string | null;
          rest_seconds?: number | null;
          notes?: string | null;
          superset_group?: string | null;
          is_warmup?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          name?: string;
          order_index?: number;
          sets?: number;
          reps_min?: number | null;
          reps_max?: number | null;
          reps_target?: string | null;
          rpe_target?: number | null;
          percentage_1rm?: number | null;
          tempo?: string | null;
          rest_seconds?: number | null;
          notes?: string | null;
          superset_group?: string | null;
          is_warmup?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      training_plan_history: {
        Row: {
          id: string;
          client_id: string;
          plan_id: string | null;
          coach_prompt: string;
          ai_response_raw: string | null;
          plan_snapshot: any;
          client_metrics_snapshot: any | null;
          check_in_data_snapshot: any | null;
          regeneration_reason: string | null;
          created_by_coach_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          plan_id?: string | null;
          coach_prompt: string;
          ai_response_raw?: string | null;
          plan_snapshot: any;
          client_metrics_snapshot?: any | null;
          check_in_data_snapshot?: any | null;
          regeneration_reason?: string | null;
          created_by_coach_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          plan_id?: string | null;
          coach_prompt?: string;
          ai_response_raw?: string | null;
          plan_snapshot?: any;
          client_metrics_snapshot?: any | null;
          check_in_data_snapshot?: any | null;
          regeneration_reason?: string | null;
          created_by_coach_id?: string | null;
          created_at?: string;
        };
      };
      activity_suggestions: {
        Row: {
          id: string;
          activity_name: string;
          category: string;
          default_met_low: number;
          default_met_moderate: number;
          default_met_vigorous: number;
          muscle_groups_impacted: string[] | null;
          recovery_notes: string | null;
          popularity_score: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          activity_name: string;
          category: string;
          default_met_low: number;
          default_met_moderate: number;
          default_met_vigorous: number;
          muscle_groups_impacted?: string[] | null;
          recovery_notes?: string | null;
          popularity_score?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          activity_name?: string;
          category?: string;
          default_met_low?: number;
          default_met_moderate?: number;
          default_met_vigorous?: number;
          muscle_groups_impacted?: string[] | null;
          recovery_notes?: string | null;
          popularity_score?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
    Functions: {
      increment_activity_popularity: {
        Args: { p_activity_name: string };
        Returns: undefined;
      };
    };
  };
};

// Type aliases for better readability
export type CheckInRow = Database["public"]["Tables"]["check_ins"]["Row"];
export type CheckInTokenRow = Database["public"]["Tables"]["check_in_tokens"]["Row"];
export type TrainingPlanRow = Database["public"]["Tables"]["training_plans"]["Row"];
export type TrainingSessionRow = Database["public"]["Tables"]["training_sessions"]["Row"];
export type TrainingExerciseRow = Database["public"]["Tables"]["training_exercises"]["Row"];
export type TrainingPlanHistoryRow = Database["public"]["Tables"]["training_plan_history"]["Row"];
export type TrainingPlanInsert = Database["public"]["Tables"]["training_plans"]["Insert"];
export type TrainingSessionInsert = Database["public"]["Tables"]["training_sessions"]["Insert"];
export type TrainingExerciseInsert = Database["public"]["Tables"]["training_exercises"]["Insert"];

/**
 * Maps a database row from check_ins table to CheckIn type
 * Converts snake_case database fields to camelCase application fields
 */
export function mapCheckInFromDatabase(row: CheckInRow | any): CheckIn {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client?.name,
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
