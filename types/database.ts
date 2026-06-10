export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      attention_dismissals: {
        Row: {
          alert_type: string
          client_id: string
          coach_id: string
          created_at: string
          dismissed_at: string
          id: string
        }
        Insert: {
          alert_type: string
          client_id: string
          coach_id: string
          created_at?: string
          dismissed_at?: string
          id?: string
        }
        Update: {
          alert_type?: string
          client_id?: string
          coach_id?: string
          created_at?: string
          dismissed_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attention_dismissals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attention_dismissals_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string | null
          client_id: string | null
          created_at: string
          id: string
          ip_hash: string | null
          metadata: Json
          target_id: string | null
          target_table: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role?: string | null
          client_id?: string | null
          created_at?: string
          id?: string
          ip_hash?: string | null
          metadata?: Json
          target_id?: string | null
          target_table?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string | null
          client_id?: string | null
          created_at?: string
          id?: string
          ip_hash?: string | null
          metadata?: Json
          target_id?: string | null
          target_table?: string | null
        }
        Relationships: []
      }
      body_metrics: {
        Row: {
          bmr: number | null
          body_fat_percentage: number | null
          client_id: string
          created_at: string
          id: string
          recorded_at: string
          source: string
          source_id: string | null
          tdee: number | null
          weight: number | null
          weight_unit: string | null
        }
        Insert: {
          bmr?: number | null
          body_fat_percentage?: number | null
          client_id: string
          created_at?: string
          id?: string
          recorded_at?: string
          source: string
          source_id?: string | null
          tdee?: number | null
          weight?: number | null
          weight_unit?: string | null
        }
        Update: {
          bmr?: number | null
          body_fat_percentage?: number | null
          client_id?: string
          created_at?: string
          id?: string
          recorded_at?: string
          source?: string
          source_id?: string | null
          tdee?: number | null
          weight?: number | null
          weight_unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "body_metrics_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      check_in_exercise_highlights: {
        Row: {
          check_in_id: string
          created_at: string
          details: string | null
          exercise_id: string | null
          exercise_name: string
          highlight_type: string
          id: string
          reps: number | null
          weight_unit: string | null
          weight_value: number | null
        }
        Insert: {
          check_in_id: string
          created_at?: string
          details?: string | null
          exercise_id?: string | null
          exercise_name: string
          highlight_type: string
          id?: string
          reps?: number | null
          weight_unit?: string | null
          weight_value?: number | null
        }
        Update: {
          check_in_id?: string
          created_at?: string
          details?: string | null
          exercise_id?: string | null
          exercise_name?: string
          highlight_type?: string
          id?: string
          reps?: number | null
          weight_unit?: string | null
          weight_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "check_in_exercise_highlights_check_in_id_fkey"
            columns: ["check_in_id"]
            isOneToOne: false
            referencedRelation: "check_ins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_in_exercise_highlights_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "training_exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      check_in_reminders: {
        Row: {
          check_in_id: string | null
          client_id: string
          created_at: string | null
          days_overdue: number | null
          id: string
          notes: string | null
          reminder_type: string
          responded: boolean | null
          responded_at: string | null
          sent_at: string | null
          sent_via: string | null
        }
        Insert: {
          check_in_id?: string | null
          client_id: string
          created_at?: string | null
          days_overdue?: number | null
          id?: string
          notes?: string | null
          reminder_type: string
          responded?: boolean | null
          responded_at?: string | null
          sent_at?: string | null
          sent_via?: string | null
        }
        Update: {
          check_in_id?: string | null
          client_id?: string
          created_at?: string | null
          days_overdue?: number | null
          id?: string
          notes?: string | null
          reminder_type?: string
          responded?: boolean | null
          responded_at?: string | null
          sent_at?: string | null
          sent_via?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "check_in_reminders_check_in_id_fkey"
            columns: ["check_in_id"]
            isOneToOne: false
            referencedRelation: "check_ins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_in_reminders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      check_in_tokens: {
        Row: {
          check_in_id: string | null
          client_id: string
          created_at: string | null
          expires_at: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          check_in_id?: string | null
          client_id: string
          created_at?: string | null
          expires_at: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          check_in_id?: string | null
          client_id?: string
          created_at?: string | null
          expires_at?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "check_in_tokens_check_in_id_fkey"
            columns: ["check_in_id"]
            isOneToOne: false
            referencedRelation: "check_ins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_in_tokens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      check_ins: {
        Row: {
          adherence_percentage: number | null
          ai_insights: Json | null
          ai_processed_at: string | null
          ai_recommendations: Json | null
          ai_response_draft: string | null
          ai_summary: string | null
          arms: number | null
          body_fat_percentage: number | null
          challenges: string | null
          chest: number | null
          client_id: string
          coach_response: string | null
          coach_reviewed_at: string | null
          created_at: string | null
          energy: number | null
          hips: number | null
          id: string
          measurement_unit: string | null
          mood: number | null
          notes: string | null
          nutrition_days_on_target: number | null
          nutrition_notes: string | null
          period_end: string | null
          period_snapshot: Json | null
          period_start: string | null
          photo_back: string | null
          photo_front: string | null
          photo_side: string | null
          prs: string | null
          response_sent_at: string | null
          sleep: number | null
          status: string
          stress: number | null
          thighs: number | null
          updated_at: string | null
          waist: number | null
          weight: number | null
          weight_unit: string | null
          workouts_completed: number | null
        }
        Insert: {
          adherence_percentage?: number | null
          ai_insights?: Json | null
          ai_processed_at?: string | null
          ai_recommendations?: Json | null
          ai_response_draft?: string | null
          ai_summary?: string | null
          arms?: number | null
          body_fat_percentage?: number | null
          challenges?: string | null
          chest?: number | null
          client_id: string
          coach_response?: string | null
          coach_reviewed_at?: string | null
          created_at?: string | null
          energy?: number | null
          hips?: number | null
          id?: string
          measurement_unit?: string | null
          mood?: number | null
          notes?: string | null
          nutrition_days_on_target?: number | null
          nutrition_notes?: string | null
          period_end?: string | null
          period_snapshot?: Json | null
          period_start?: string | null
          photo_back?: string | null
          photo_front?: string | null
          photo_side?: string | null
          prs?: string | null
          response_sent_at?: string | null
          sleep?: number | null
          status?: string
          stress?: number | null
          thighs?: number | null
          updated_at?: string | null
          waist?: number | null
          weight?: number | null
          weight_unit?: string | null
          workouts_completed?: number | null
        }
        Update: {
          adherence_percentage?: number | null
          ai_insights?: Json | null
          ai_processed_at?: string | null
          ai_recommendations?: Json | null
          ai_response_draft?: string | null
          ai_summary?: string | null
          arms?: number | null
          body_fat_percentage?: number | null
          challenges?: string | null
          chest?: number | null
          client_id?: string
          coach_response?: string | null
          coach_reviewed_at?: string | null
          created_at?: string | null
          energy?: number | null
          hips?: number | null
          id?: string
          measurement_unit?: string | null
          mood?: number | null
          notes?: string | null
          nutrition_days_on_target?: number | null
          nutrition_notes?: string | null
          period_end?: string | null
          period_snapshot?: Json | null
          period_start?: string | null
          photo_back?: string | null
          photo_front?: string | null
          photo_side?: string | null
          prs?: string | null
          response_sent_at?: string | null
          sleep?: number | null
          status?: string
          stress?: number | null
          thighs?: number | null
          updated_at?: string | null
          waist?: number | null
          weight?: number | null
          weight_unit?: string | null
          workouts_completed?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "check_ins_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_goals: {
        Row: {
          client_id: string
          created_at: string
          effective_from: string
          goal_body_fat_percentage: number | null
          goal_deadline: string | null
          goal_start_date: string | null
          goal_weight: number | null
          id: string
          notes: string | null
          primary_goal: string | null
          set_by: string
          superseded_at: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          effective_from?: string
          goal_body_fat_percentage?: number | null
          goal_deadline?: string | null
          goal_start_date?: string | null
          goal_weight?: number | null
          id?: string
          notes?: string | null
          primary_goal?: string | null
          set_by?: string
          superseded_at?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          effective_from?: string
          goal_body_fat_percentage?: number | null
          goal_deadline?: string | null
          goal_start_date?: string | null
          goal_weight?: number | null
          id?: string
          notes?: string | null
          primary_goal?: string | null
          set_by?: string
          superseded_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_goals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_intake: {
        Row: {
          anything_else: string | null
          available_equipment: string[] | null
          biggest_nutrition_challenge: string | null
          body_fat_percentage: number | null
          client_id: string
          coach_review_notes: string | null
          completed_at: string | null
          cooking_frequency: string | null
          created_at: string | null
          current_weight: number | null
          date_of_birth: string | null
          days_per_week: number | null
          diet_description: string | null
          dietary_requirements: string[] | null
          food_allergies: string | null
          gender: string | null
          goal_body_fat_percentage: number | null
          goal_deadline: string | null
          goal_description: string | null
          goal_details: string | null
          has_tracked_macros_before: boolean | null
          height: number | null
          height_unit: string | null
          id: string
          injuries_or_limitations: string | null
          meals_per_day: number | null
          medical_notes: string | null
          motivation: string | null
          nutrition_notes: string | null
          previous_coaching_details: string | null
          previous_coaching_experience: boolean | null
          primary_goal: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          session_duration_minutes: number | null
          started_at: string | null
          status: string
          target_weight: number | null
          training_experience_level: string | null
          training_location: string | null
          training_time_preference: string | null
          updated_at: string | null
          weight_unit: string | null
          work_activity_level: string | null
        }
        Insert: {
          anything_else?: string | null
          available_equipment?: string[] | null
          biggest_nutrition_challenge?: string | null
          body_fat_percentage?: number | null
          client_id: string
          coach_review_notes?: string | null
          completed_at?: string | null
          cooking_frequency?: string | null
          created_at?: string | null
          current_weight?: number | null
          date_of_birth?: string | null
          days_per_week?: number | null
          diet_description?: string | null
          dietary_requirements?: string[] | null
          food_allergies?: string | null
          gender?: string | null
          goal_body_fat_percentage?: number | null
          goal_deadline?: string | null
          goal_description?: string | null
          goal_details?: string | null
          has_tracked_macros_before?: boolean | null
          height?: number | null
          height_unit?: string | null
          id?: string
          injuries_or_limitations?: string | null
          meals_per_day?: number | null
          medical_notes?: string | null
          motivation?: string | null
          nutrition_notes?: string | null
          previous_coaching_details?: string | null
          previous_coaching_experience?: boolean | null
          primary_goal?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          session_duration_minutes?: number | null
          started_at?: string | null
          status?: string
          target_weight?: number | null
          training_experience_level?: string | null
          training_location?: string | null
          training_time_preference?: string | null
          updated_at?: string | null
          weight_unit?: string | null
          work_activity_level?: string | null
        }
        Update: {
          anything_else?: string | null
          available_equipment?: string[] | null
          biggest_nutrition_challenge?: string | null
          body_fat_percentage?: number | null
          client_id?: string
          coach_review_notes?: string | null
          completed_at?: string | null
          cooking_frequency?: string | null
          created_at?: string | null
          current_weight?: number | null
          date_of_birth?: string | null
          days_per_week?: number | null
          diet_description?: string | null
          dietary_requirements?: string[] | null
          food_allergies?: string | null
          gender?: string | null
          goal_body_fat_percentage?: number | null
          goal_deadline?: string | null
          goal_description?: string | null
          goal_details?: string | null
          has_tracked_macros_before?: boolean | null
          height?: number | null
          height_unit?: string | null
          id?: string
          injuries_or_limitations?: string | null
          meals_per_day?: number | null
          medical_notes?: string | null
          motivation?: string | null
          nutrition_notes?: string | null
          previous_coaching_details?: string | null
          previous_coaching_experience?: boolean | null
          primary_goal?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          session_duration_minutes?: number | null
          started_at?: string | null
          status?: string
          target_weight?: number | null
          training_experience_level?: string | null
          training_location?: string | null
          training_time_preference?: string | null
          updated_at?: string | null
          weight_unit?: string | null
          work_activity_level?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_intake_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_intake_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
        ]
      }
      client_invitations: {
        Row: {
          accepted_at: string | null
          client_id: string
          created_at: string
          email: string
          expires_at: string | null
          id: string
          invited_at: string | null
          status: string
          token: string | null
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          client_id: string
          created_at?: string
          email: string
          expires_at?: string | null
          id?: string
          invited_at?: string | null
          status?: string
          token?: string | null
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          client_id?: string
          created_at?: string
          email?: string
          expires_at?: string | null
          id?: string
          invited_at?: string | null
          status?: string
          token?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_invitations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          active: boolean | null
          avatar_url: string | null
          bmr: number | null
          bmr_manual_override: boolean | null
          check_in_adherence_rate: number | null
          check_in_frequency: string | null
          check_in_frequency_days: number | null
          coach_id: string
          created_at: string | null
          current_body_fat_percentage: number | null
          current_streak: number | null
          current_weight: number | null
          date_of_birth: string | null
          email: string
          expected_check_in_day: string | null
          gender: string | null
          goal_body_fat_percentage: number | null
          goal_deadline: string | null
          goal_weight: number | null
          height: number | null
          height_unit: string | null
          id: string
          include_activity_burn: boolean
          last_reminder_sent_at: string | null
          longest_streak: number | null
          name: string
          notes: string | null
          onboarding_status: string | null
          reminder_preferences: Json | null
          start_date: string | null
          starting_body_fat_percentage: number | null
          starting_weight: number | null
          tdee: number | null
          tdee_manual_override: boolean | null
          timezone: string
          total_check_ins_completed: number | null
          total_check_ins_expected: number | null
          unit_preference: string | null
          updated_at: string | null
          user_id: string | null
          walkthrough_completed_at: string | null
          weight_unit: string | null
          welcome_message: string | null
          work_activity_level: string | null
        }
        Insert: {
          active?: boolean | null
          avatar_url?: string | null
          bmr?: number | null
          bmr_manual_override?: boolean | null
          check_in_adherence_rate?: number | null
          check_in_frequency?: string | null
          check_in_frequency_days?: number | null
          coach_id: string
          created_at?: string | null
          current_body_fat_percentage?: number | null
          current_streak?: number | null
          current_weight?: number | null
          date_of_birth?: string | null
          email: string
          expected_check_in_day?: string | null
          gender?: string | null
          goal_body_fat_percentage?: number | null
          goal_deadline?: string | null
          goal_weight?: number | null
          height?: number | null
          height_unit?: string | null
          id?: string
          include_activity_burn?: boolean
          last_reminder_sent_at?: string | null
          longest_streak?: number | null
          name: string
          notes?: string | null
          onboarding_status?: string | null
          reminder_preferences?: Json | null
          start_date?: string | null
          starting_body_fat_percentage?: number | null
          starting_weight?: number | null
          tdee?: number | null
          tdee_manual_override?: boolean | null
          timezone?: string
          total_check_ins_completed?: number | null
          total_check_ins_expected?: number | null
          unit_preference?: string | null
          updated_at?: string | null
          user_id?: string | null
          walkthrough_completed_at?: string | null
          weight_unit?: string | null
          welcome_message?: string | null
          work_activity_level?: string | null
        }
        Update: {
          active?: boolean | null
          avatar_url?: string | null
          bmr?: number | null
          bmr_manual_override?: boolean | null
          check_in_adherence_rate?: number | null
          check_in_frequency?: string | null
          check_in_frequency_days?: number | null
          coach_id?: string
          created_at?: string | null
          current_body_fat_percentage?: number | null
          current_streak?: number | null
          current_weight?: number | null
          date_of_birth?: string | null
          email?: string
          expected_check_in_day?: string | null
          gender?: string | null
          goal_body_fat_percentage?: number | null
          goal_deadline?: string | null
          goal_weight?: number | null
          height?: number | null
          height_unit?: string | null
          id?: string
          include_activity_burn?: boolean
          last_reminder_sent_at?: string | null
          longest_streak?: number | null
          name?: string
          notes?: string | null
          onboarding_status?: string | null
          reminder_preferences?: Json | null
          start_date?: string | null
          starting_body_fat_percentage?: number | null
          starting_weight?: number | null
          tdee?: number | null
          tdee_manual_override?: boolean | null
          timezone?: string
          total_check_ins_completed?: number | null
          total_check_ins_expected?: number | null
          unit_preference?: string | null
          updated_at?: string | null
          user_id?: string | null
          walkthrough_completed_at?: string | null
          weight_unit?: string | null
          welcome_message?: string | null
          work_activity_level?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_client_views: {
        Row: {
          client_id: string
          coach_id: string
          last_viewed_at: string
        }
        Insert: {
          client_id: string
          coach_id: string
          last_viewed_at?: string
        }
        Update: {
          client_id?: string
          coach_id?: string
          last_viewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_client_views_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_client_views_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_saved_exercises: {
        Row: {
          created_at: string
          exercise_id: string | null
          id: string
          is_warmup: boolean | null
          name: string
          notes: string | null
          order_index: number
          percentage_1rm: number | null
          reps_max: number | null
          reps_min: number | null
          reps_target: string | null
          rest_seconds: number | null
          rpe_target: number | null
          saved_session_id: string
          sets: number
          superset_group: string | null
          tempo: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          exercise_id?: string | null
          id?: string
          is_warmup?: boolean | null
          name: string
          notes?: string | null
          order_index?: number
          percentage_1rm?: number | null
          reps_max?: number | null
          reps_min?: number | null
          reps_target?: string | null
          rest_seconds?: number | null
          rpe_target?: number | null
          saved_session_id: string
          sets?: number
          superset_group?: string | null
          tempo?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          exercise_id?: string | null
          id?: string
          is_warmup?: boolean | null
          name?: string
          notes?: string | null
          order_index?: number
          percentage_1rm?: number | null
          reps_max?: number | null
          reps_min?: number | null
          reps_target?: string | null
          rest_seconds?: number | null
          rpe_target?: number | null
          saved_session_id?: string
          sets?: number
          superset_group?: string | null
          tempo?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_saved_exercises_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_saved_exercises_saved_session_id_fkey"
            columns: ["saved_session_id"]
            isOneToOne: false
            referencedRelation: "coach_saved_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_saved_plans: {
        Row: {
          coach_id: string
          coach_prompt: string | null
          created_at: string
          cycle_length: number | null
          default_surplus_percentage: number | null
          description: string | null
          frequency_per_week: number | null
          id: string
          name: string
          program_duration_weeks: number | null
          rest_pattern: number[] | null
          source: string | null
          split_type: string | null
          status: string
          updated_at: string
        }
        Insert: {
          coach_id: string
          coach_prompt?: string | null
          created_at?: string
          cycle_length?: number | null
          default_surplus_percentage?: number | null
          description?: string | null
          frequency_per_week?: number | null
          id?: string
          name: string
          program_duration_weeks?: number | null
          rest_pattern?: number[] | null
          source?: string | null
          split_type?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          coach_id?: string
          coach_prompt?: string | null
          created_at?: string
          cycle_length?: number | null
          default_surplus_percentage?: number | null
          description?: string | null
          frequency_per_week?: number | null
          id?: string
          name?: string
          program_duration_weeks?: number | null
          rest_pattern?: number[] | null
          source?: string | null
          split_type?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_saved_plans_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_saved_sessions: {
        Row: {
          calorie_surplus_percentage: number | null
          coach_id: string
          created_at: string
          estimated_duration_minutes: number | null
          focus: string | null
          id: string
          is_rest: boolean | null
          name: string
          notes: string | null
          order_index: number
          saved_plan_id: string | null
          session_type: string
          updated_at: string
        }
        Insert: {
          calorie_surplus_percentage?: number | null
          coach_id: string
          created_at?: string
          estimated_duration_minutes?: number | null
          focus?: string | null
          id?: string
          is_rest?: boolean | null
          name: string
          notes?: string | null
          order_index?: number
          saved_plan_id?: string | null
          session_type?: string
          updated_at?: string
        }
        Update: {
          calorie_surplus_percentage?: number | null
          coach_id?: string
          created_at?: string
          estimated_duration_minutes?: number | null
          focus?: string | null
          id?: string
          is_rest?: boolean | null
          name?: string
          notes?: string | null
          order_index?: number
          saved_plan_id?: string | null
          session_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_saved_sessions_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_saved_sessions_saved_plan_id_fkey"
            columns: ["saved_plan_id"]
            isOneToOne: false
            referencedRelation: "coach_saved_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      coaches: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string
          id: string
          name: string
          timezone: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email: string
          id?: string
          name: string
          timezone?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string
          id?: string
          name?: string
          timezone?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      content_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string
          client_id: string
          content_id: string
          id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by: string
          client_id: string
          content_id: string
          id?: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string
          client_id?: string
          content_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_assignments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_assignments_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
        ]
      }
      content_folders: {
        Row: {
          coach_id: string
          created_at: string
          id: string
          name: string
          parent_folder_id: string | null
          sort_order: number | null
          updated_at: string
        }
        Insert: {
          coach_id: string
          created_at?: string
          id?: string
          name: string
          parent_folder_id?: string | null
          sort_order?: number | null
          updated_at?: string
        }
        Update: {
          coach_id?: string
          created_at?: string
          id?: string
          name?: string
          parent_folder_id?: string | null
          sort_order?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_folders_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_folders_parent_folder_id_fkey"
            columns: ["parent_folder_id"]
            isOneToOne: false
            referencedRelation: "content_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      content_items: {
        Row: {
          coach_id: string
          created_at: string
          description: string | null
          file_name: string | null
          file_size: number | null
          folder_id: string | null
          id: string
          is_library: boolean | null
          metadata: Json | null
          mime_type: string | null
          sort_order: number | null
          storage_path: string | null
          thumbnail_url: string | null
          title: string
          type: Database["public"]["Enums"]["content_type"]
          updated_at: string
          url: string | null
        }
        Insert: {
          coach_id: string
          created_at?: string
          description?: string | null
          file_name?: string | null
          file_size?: number | null
          folder_id?: string | null
          id?: string
          is_library?: boolean | null
          metadata?: Json | null
          mime_type?: string | null
          sort_order?: number | null
          storage_path?: string | null
          thumbnail_url?: string | null
          title: string
          type: Database["public"]["Enums"]["content_type"]
          updated_at?: string
          url?: string | null
        }
        Update: {
          coach_id?: string
          created_at?: string
          description?: string | null
          file_name?: string | null
          file_size?: number | null
          folder_id?: string | null
          id?: string
          is_library?: boolean | null
          metadata?: Json | null
          mime_type?: string | null
          sort_order?: number | null
          storage_path?: string | null
          thumbnail_url?: string | null
          title?: string
          type?: Database["public"]["Enums"]["content_type"]
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_items_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_items_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "content_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_habit_logs: {
        Row: {
          client_id: string
          completed: boolean
          created_at: string
          daily_habit_id: string
          date: string
          id: string
          notes: string | null
          phase_id: string | null
          updated_at: string
          value: number | null
        }
        Insert: {
          client_id: string
          completed?: boolean
          created_at?: string
          daily_habit_id: string
          date: string
          id?: string
          notes?: string | null
          phase_id?: string | null
          updated_at?: string
          value?: number | null
        }
        Update: {
          client_id?: string
          completed?: boolean
          created_at?: string
          daily_habit_id?: string
          date?: string
          id?: string
          notes?: string | null
          phase_id?: string | null
          updated_at?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_habit_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_habit_logs_daily_habit_id_fkey"
            columns: ["daily_habit_id"]
            isOneToOne: false
            referencedRelation: "daily_habits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_habit_logs_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "phases"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_habits: {
        Row: {
          client_id: string
          coach_id: string
          created_at: string
          description: string | null
          effective_date: string
          id: string
          is_active: boolean
          is_boolean: boolean
          name: string
          phase_id: string | null
          sort_order: number
          target_unit: string | null
          target_value: number | null
          updated_at: string
        }
        Insert: {
          client_id: string
          coach_id: string
          created_at?: string
          description?: string | null
          effective_date?: string
          id?: string
          is_active?: boolean
          is_boolean?: boolean
          name: string
          phase_id?: string | null
          sort_order?: number
          target_unit?: string | null
          target_value?: number | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          coach_id?: string
          created_at?: string
          description?: string | null
          effective_date?: string
          id?: string
          is_active?: boolean
          is_boolean?: boolean
          name?: string
          phase_id?: string | null
          sort_order?: number
          target_unit?: string | null
          target_value?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_habits_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_habits_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_habits_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "phases"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_logs: {
        Row: {
          client_id: string
          created_at: string
          date: string
          id: string
          notes: string | null
          phase_id: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          date: string
          id?: string
          notes?: string | null
          phase_id?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          date?: string
          id?: string
          notes?: string | null
          phase_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_logs_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "phases"
            referencedColumns: ["id"]
          },
        ]
      }
      exercise_logs: {
        Row: {
          completed: boolean | null
          created_at: string
          exercise_id: string | null
          id: string
          notes: string | null
          performed_name: string | null
          prescribed_exercise_snapshot: Json | null
          session_log_id: string
          training_exercise_id: string | null
          updated_at: string
          weight_unit: string | null
        }
        Insert: {
          completed?: boolean | null
          created_at?: string
          exercise_id?: string | null
          id?: string
          notes?: string | null
          performed_name?: string | null
          prescribed_exercise_snapshot?: Json | null
          session_log_id: string
          training_exercise_id?: string | null
          updated_at?: string
          weight_unit?: string | null
        }
        Update: {
          completed?: boolean | null
          created_at?: string
          exercise_id?: string | null
          id?: string
          notes?: string | null
          performed_name?: string | null
          prescribed_exercise_snapshot?: Json | null
          session_log_id?: string
          training_exercise_id?: string | null
          updated_at?: string
          weight_unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exercise_logs_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exercise_logs_session_log_id_fkey"
            columns: ["session_log_id"]
            isOneToOne: false
            referencedRelation: "session_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exercise_logs_training_exercise_id_fkey"
            columns: ["training_exercise_id"]
            isOneToOne: false
            referencedRelation: "training_exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      exercises: {
        Row: {
          aliases: string[] | null
          category: string | null
          coach_id: string | null
          created_at: string
          equipment: string | null
          id: string
          muscle_group: string | null
          name: string
          updated_at: string
        }
        Insert: {
          aliases?: string[] | null
          category?: string | null
          coach_id?: string | null
          created_at?: string
          equipment?: string | null
          id?: string
          muscle_group?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          aliases?: string[] | null
          category?: string | null
          coach_id?: string | null
          created_at?: string
          equipment?: string | null
          id?: string
          muscle_group?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exercises_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
        ]
      }
      nutrition_events: {
        Row: {
          baseline_calories: number
          calorie_surplus_percentage: number | null
          carb_g: number
          client_id: string
          created_at: string
          date: string
          day_of_week: string
          diet_type: string
          fat_g: number
          id: string
          is_training_day: boolean
          nutrition_plan_id: string
          protein_g: number
          status: string
          training_burn_calories: number
          updated_at: string
        }
        Insert: {
          baseline_calories: number
          calorie_surplus_percentage?: number | null
          carb_g: number
          client_id: string
          created_at?: string
          date: string
          day_of_week: string
          diet_type?: string
          fat_g: number
          id?: string
          is_training_day?: boolean
          nutrition_plan_id: string
          protein_g: number
          status?: string
          training_burn_calories?: number
          updated_at?: string
        }
        Update: {
          baseline_calories?: number
          calorie_surplus_percentage?: number | null
          carb_g?: number
          client_id?: string
          created_at?: string
          date?: string
          day_of_week?: string
          diet_type?: string
          fat_g?: number
          id?: string
          is_training_day?: boolean
          nutrition_plan_id?: string
          protein_g?: number
          status?: string
          training_burn_calories?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nutrition_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nutrition_events_nutrition_plan_id_fkey"
            columns: ["nutrition_plan_id"]
            isOneToOne: false
            referencedRelation: "nutrition_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      nutrition_logs: {
        Row: {
          calorie_surplus_deficit: number | null
          calories_consumed: number | null
          carbs_g: number | null
          client_id: string
          created_at: string
          daily_log_id: string
          date: string
          fat_g: number | null
          id: string
          nutrition_adherence: string | null
          nutrition_plan_id: string | null
          protein_g: number | null
          target_calories: number | null
          target_carbs_g: number | null
          target_fat_g: number | null
          target_protein_g: number | null
          updated_at: string
        }
        Insert: {
          calorie_surplus_deficit?: number | null
          calories_consumed?: number | null
          carbs_g?: number | null
          client_id: string
          created_at?: string
          daily_log_id: string
          date: string
          fat_g?: number | null
          id?: string
          nutrition_adherence?: string | null
          nutrition_plan_id?: string | null
          protein_g?: number | null
          target_calories?: number | null
          target_carbs_g?: number | null
          target_fat_g?: number | null
          target_protein_g?: number | null
          updated_at?: string
        }
        Update: {
          calorie_surplus_deficit?: number | null
          calories_consumed?: number | null
          carbs_g?: number | null
          client_id?: string
          created_at?: string
          daily_log_id?: string
          date?: string
          fat_g?: number | null
          id?: string
          nutrition_adherence?: string | null
          nutrition_plan_id?: string | null
          protein_g?: number | null
          target_calories?: number | null
          target_carbs_g?: number | null
          target_fat_g?: number | null
          target_protein_g?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nutrition_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nutrition_logs_daily_log_id_fkey"
            columns: ["daily_log_id"]
            isOneToOne: true
            referencedRelation: "daily_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nutrition_logs_daily_log_id_fkey"
            columns: ["daily_log_id"]
            isOneToOne: true
            referencedRelation: "daily_logs_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nutrition_logs_nutrition_plan_id_fkey"
            columns: ["nutrition_plan_id"]
            isOneToOne: false
            referencedRelation: "nutrition_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      nutrition_plan_daily_targets: {
        Row: {
          calories: number
          carb_g: number
          day_of_week: string
          fat_g: number
          id: string
          is_training_day: boolean
          nutrition_plan_id: string
          protein_g: number
        }
        Insert: {
          calories: number
          carb_g: number
          day_of_week: string
          fat_g: number
          id?: string
          is_training_day?: boolean
          nutrition_plan_id: string
          protein_g: number
        }
        Update: {
          calories?: number
          carb_g?: number
          day_of_week?: string
          fat_g?: number
          id?: string
          is_training_day?: boolean
          nutrition_plan_id?: string
          protein_g?: number
        }
        Relationships: [
          {
            foreignKeyName: "nutrition_plan_daily_targets_nutrition_plan_id_fkey"
            columns: ["nutrition_plan_id"]
            isOneToOne: false
            referencedRelation: "nutrition_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      nutrition_plans: {
        Row: {
          base_weight_kg: number
          baseline_calories: number
          bmr: number | null
          carb_target_g: number
          client_id: string
          coach_id: string
          coach_notes: string | null
          created_at: string
          custom_calories: number | null
          custom_carb_g: number | null
          custom_fat_g: number | null
          custom_macros_enabled: boolean
          custom_protein_g: number | null
          diet_type: string
          effective_from: string
          effective_until: string | null
          fat_target_g: number
          goal_deadline: string | null
          goal_source: string | null
          goal_weight_kg: number | null
          id: string
          name: string | null
          phase_id: string | null
          protein_target_g: number
          protein_target_g_per_kg: number
          regeneration_reason: string | null
          status: string
          tdee: number | null
          training_volume_hours: string
          updated_at: string
          work_activity_level: string
        }
        Insert: {
          base_weight_kg: number
          baseline_calories: number
          bmr?: number | null
          carb_target_g: number
          client_id: string
          coach_id: string
          coach_notes?: string | null
          created_at?: string
          custom_calories?: number | null
          custom_carb_g?: number | null
          custom_fat_g?: number | null
          custom_macros_enabled?: boolean
          custom_protein_g?: number | null
          diet_type?: string
          effective_from: string
          effective_until?: string | null
          fat_target_g: number
          goal_deadline?: string | null
          goal_source?: string | null
          goal_weight_kg?: number | null
          id?: string
          name?: string | null
          phase_id?: string | null
          protein_target_g: number
          protein_target_g_per_kg?: number
          regeneration_reason?: string | null
          status?: string
          tdee?: number | null
          training_volume_hours: string
          updated_at?: string
          work_activity_level: string
        }
        Update: {
          base_weight_kg?: number
          baseline_calories?: number
          bmr?: number | null
          carb_target_g?: number
          client_id?: string
          coach_id?: string
          coach_notes?: string | null
          created_at?: string
          custom_calories?: number | null
          custom_carb_g?: number | null
          custom_fat_g?: number | null
          custom_macros_enabled?: boolean
          custom_protein_g?: number | null
          diet_type?: string
          effective_from?: string
          effective_until?: string | null
          fat_target_g?: number
          goal_deadline?: string | null
          goal_source?: string | null
          goal_weight_kg?: number | null
          id?: string
          name?: string | null
          phase_id?: string | null
          protein_target_g?: number
          protein_target_g_per_kg?: number
          regeneration_reason?: string | null
          status?: string
          tdee?: number | null
          training_volume_hours?: string
          updated_at?: string
          work_activity_level?: string
        }
        Relationships: [
          {
            foreignKeyName: "nutrition_plans_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nutrition_plans_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nutrition_plans_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "phases"
            referencedColumns: ["id"]
          },
        ]
      }
      nutrition_weekly_summaries: {
        Row: {
          adherence_percentage: number | null
          calorie_difference: number | null
          client_id: string
          completion_percentage: number | null
          created_at: string
          days_completed: number | null
          days_logged: number | null
          days_on_target: number | null
          days_over: number | null
          days_under: number | null
          id: string
          rest_days_per_week: number | null
          total_calories_consumed: number | null
          total_carbs_consumed_g: number | null
          total_days: number | null
          total_fat_consumed_g: number | null
          total_protein_consumed_g: number | null
          training_days_per_week: number | null
          updated_at: string
          week_end_date: string | null
          week_start_date: string
          weekly_adherence: string | null
          weekly_calorie_target: number
          weekly_carbs_target_g: number | null
          weekly_fat_target_g: number | null
          weekly_protein_target_g: number | null
        }
        Insert: {
          adherence_percentage?: number | null
          calorie_difference?: number | null
          client_id: string
          completion_percentage?: number | null
          created_at?: string
          days_completed?: number | null
          days_logged?: number | null
          days_on_target?: number | null
          days_over?: number | null
          days_under?: number | null
          id?: string
          rest_days_per_week?: number | null
          total_calories_consumed?: number | null
          total_carbs_consumed_g?: number | null
          total_days?: number | null
          total_fat_consumed_g?: number | null
          total_protein_consumed_g?: number | null
          training_days_per_week?: number | null
          updated_at?: string
          week_end_date?: string | null
          week_start_date: string
          weekly_adherence?: string | null
          weekly_calorie_target: number
          weekly_carbs_target_g?: number | null
          weekly_fat_target_g?: number | null
          weekly_protein_target_g?: number | null
        }
        Update: {
          adherence_percentage?: number | null
          calorie_difference?: number | null
          client_id?: string
          completion_percentage?: number | null
          created_at?: string
          days_completed?: number | null
          days_logged?: number | null
          days_on_target?: number | null
          days_over?: number | null
          days_under?: number | null
          id?: string
          rest_days_per_week?: number | null
          total_calories_consumed?: number | null
          total_carbs_consumed_g?: number | null
          total_days?: number | null
          total_fat_consumed_g?: number | null
          total_protein_consumed_g?: number | null
          training_days_per_week?: number | null
          updated_at?: string
          week_end_date?: string | null
          week_start_date?: string
          weekly_adherence?: string | null
          weekly_calorie_target?: number
          weekly_carbs_target_g?: number | null
          weekly_fat_target_g?: number | null
          weekly_protein_target_g?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "nutrition_weekly_summaries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      phases: {
        Row: {
          client_id: string
          coach_reflection: string | null
          completion_seen: boolean
          created_at: string
          description: string | null
          duration_weeks: number | null
          end_date: string | null
          id: string
          milestones: Json
          name: string
          objectives: string | null
          order_index: number
          phase_goal_body_fat_percentage: number | null
          phase_goal_weight: number | null
          phase_goals_snapshot: Json | null
          phase_summary: Json | null
          roadmap_id: string
          start_date: string | null
          status: string
          updated_at: string
        }
        Insert: {
          client_id: string
          coach_reflection?: string | null
          completion_seen?: boolean
          created_at?: string
          description?: string | null
          duration_weeks?: number | null
          end_date?: string | null
          id?: string
          milestones?: Json
          name: string
          objectives?: string | null
          order_index?: number
          phase_goal_body_fat_percentage?: number | null
          phase_goal_weight?: number | null
          phase_goals_snapshot?: Json | null
          phase_summary?: Json | null
          roadmap_id: string
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          coach_reflection?: string | null
          completion_seen?: boolean
          created_at?: string
          description?: string | null
          duration_weeks?: number | null
          end_date?: string | null
          id?: string
          milestones?: Json
          name?: string
          objectives?: string | null
          order_index?: number
          phase_goal_body_fat_percentage?: number | null
          phase_goal_weight?: number | null
          phase_goals_snapshot?: Json | null
          phase_summary?: Json | null
          roadmap_id?: string
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "phases_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phases_roadmap_id_fkey"
            columns: ["roadmap_id"]
            isOneToOne: false
            referencedRelation: "roadmaps"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      roadmaps: {
        Row: {
          client_id: string
          coach_id: string
          created_at: string
          goal_body_fat_percentage: number | null
          goal_weight: number | null
          id: string
          long_term_goal: string | null
          name: string
          started_at: string | null
          status: string
          target_end_date: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          coach_id: string
          created_at?: string
          goal_body_fat_percentage?: number | null
          goal_weight?: number | null
          id?: string
          long_term_goal?: string | null
          name?: string
          started_at?: string | null
          status?: string
          target_end_date?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          coach_id?: string
          created_at?: string
          goal_body_fat_percentage?: number | null
          goal_weight?: number | null
          id?: string
          long_term_goal?: string | null
          name?: string
          started_at?: string | null
          status?: string
          target_end_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roadmaps_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roadmaps_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
        ]
      }
      session_logs: {
        Row: {
          client_id: string
          completed_at: string
          completion_quality: string | null
          created_at: string
          id: string
          notes: string | null
          prescribed_session_snapshot: Json | null
          training_event_id: string | null
          training_session_id: string | null
          updated_at: string
          week_start_date: string
        }
        Insert: {
          client_id: string
          completed_at?: string
          completion_quality?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          prescribed_session_snapshot?: Json | null
          training_event_id?: string | null
          training_session_id?: string | null
          updated_at?: string
          week_start_date: string
        }
        Update: {
          client_id?: string
          completed_at?: string
          completion_quality?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          prescribed_session_snapshot?: Json | null
          training_event_id?: string | null
          training_session_id?: string | null
          updated_at?: string
          week_start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_logs_training_event_id_fkey"
            columns: ["training_event_id"]
            isOneToOne: false
            referencedRelation: "training_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_logs_training_session_id_fkey"
            columns: ["training_session_id"]
            isOneToOne: false
            referencedRelation: "training_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      set_logs: {
        Row: {
          created_at: string
          exercise_log_id: string
          id: string
          reps: number | null
          rpe: number | null
          set_number: number
          updated_at: string
          weight: number | null
        }
        Insert: {
          created_at?: string
          exercise_log_id: string
          id?: string
          reps?: number | null
          rpe?: number | null
          set_number: number
          updated_at?: string
          weight?: number | null
        }
        Update: {
          created_at?: string
          exercise_log_id?: string
          id?: string
          reps?: number | null
          rpe?: number | null
          set_number?: number
          updated_at?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "set_logs_exercise_log_id_fkey"
            columns: ["exercise_log_id"]
            isOneToOne: false
            referencedRelation: "exercise_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      training_events: {
        Row: {
          calorie_surplus_percentage: number | null
          client_id: string
          created_at: string
          date: string
          estimated_calories: number | null
          id: string
          is_modified: boolean
          session_focus: string | null
          session_log_id: string | null
          session_name: string
          status: string
          training_plan_id: string
          training_session_id: string | null
          updated_at: string
        }
        Insert: {
          calorie_surplus_percentage?: number | null
          client_id: string
          created_at?: string
          date: string
          estimated_calories?: number | null
          id?: string
          is_modified?: boolean
          session_focus?: string | null
          session_log_id?: string | null
          session_name: string
          status?: string
          training_plan_id: string
          training_session_id?: string | null
          updated_at?: string
        }
        Update: {
          calorie_surplus_percentage?: number | null
          client_id?: string
          created_at?: string
          date?: string
          estimated_calories?: number | null
          id?: string
          is_modified?: boolean
          session_focus?: string | null
          session_log_id?: string | null
          session_name?: string
          status?: string
          training_plan_id?: string
          training_session_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_events_session_log_id_fkey"
            columns: ["session_log_id"]
            isOneToOne: false
            referencedRelation: "session_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_events_training_plan_id_fkey"
            columns: ["training_plan_id"]
            isOneToOne: false
            referencedRelation: "training_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_events_training_session_id_fkey"
            columns: ["training_session_id"]
            isOneToOne: false
            referencedRelation: "training_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      training_exercises: {
        Row: {
          created_at: string
          exercise_id: string | null
          id: string
          is_active: boolean
          is_warmup: boolean | null
          name: string
          notes: string | null
          order_index: number
          percentage_1rm: number | null
          reps_max: number | null
          reps_min: number | null
          reps_target: string | null
          rest_seconds: number | null
          rpe_target: number | null
          session_id: string
          sets: number
          superset_group: string | null
          tempo: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          exercise_id?: string | null
          id?: string
          is_active?: boolean
          is_warmup?: boolean | null
          name: string
          notes?: string | null
          order_index?: number
          percentage_1rm?: number | null
          reps_max?: number | null
          reps_min?: number | null
          reps_target?: string | null
          rest_seconds?: number | null
          rpe_target?: number | null
          session_id: string
          sets: number
          superset_group?: string | null
          tempo?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          exercise_id?: string | null
          id?: string
          is_active?: boolean
          is_warmup?: boolean | null
          name?: string
          notes?: string | null
          order_index?: number
          percentage_1rm?: number | null
          reps_max?: number | null
          reps_min?: number | null
          reps_target?: string | null
          rest_seconds?: number | null
          rpe_target?: number | null
          session_id?: string
          sets?: number
          superset_group?: string | null
          tempo?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_exercises_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_exercises_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "training_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      training_logs: {
        Row: {
          client_id: string
          created_at: string
          daily_log_id: string
          date: string
          id: string
          trained: boolean | null
          training_data: Json | null
          training_plan_id: string | null
          training_session_id: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          daily_log_id: string
          date: string
          id?: string
          trained?: boolean | null
          training_data?: Json | null
          training_plan_id?: string | null
          training_session_id?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          daily_log_id?: string
          date?: string
          id?: string
          trained?: boolean | null
          training_data?: Json | null
          training_plan_id?: string | null
          training_session_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_logs_daily_log_id_fkey"
            columns: ["daily_log_id"]
            isOneToOne: true
            referencedRelation: "daily_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_logs_daily_log_id_fkey"
            columns: ["daily_log_id"]
            isOneToOne: true
            referencedRelation: "daily_logs_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_logs_training_plan_id_fkey"
            columns: ["training_plan_id"]
            isOneToOne: false
            referencedRelation: "training_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      training_plan_history: {
        Row: {
          ai_response_raw: string | null
          check_in_data_snapshot: Json | null
          client_id: string
          client_metrics_snapshot: Json | null
          coach_prompt: string
          created_at: string
          created_by_coach_id: string | null
          id: string
          plan_id: string | null
          plan_snapshot: Json
          regeneration_reason: string | null
        }
        Insert: {
          ai_response_raw?: string | null
          check_in_data_snapshot?: Json | null
          client_id: string
          client_metrics_snapshot?: Json | null
          coach_prompt: string
          created_at?: string
          created_by_coach_id?: string | null
          id?: string
          plan_id?: string | null
          plan_snapshot: Json
          regeneration_reason?: string | null
        }
        Update: {
          ai_response_raw?: string | null
          check_in_data_snapshot?: Json | null
          client_id?: string
          client_metrics_snapshot?: Json | null
          coach_prompt?: string
          created_at?: string
          created_by_coach_id?: string | null
          id?: string
          plan_id?: string | null
          plan_snapshot?: Json
          regeneration_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "training_plan_history_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_plan_history_created_by_coach_id_fkey"
            columns: ["created_by_coach_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_plan_history_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "training_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      training_plans: {
        Row: {
          ai_response_raw: string | null
          avg_energy: number | null
          avg_mood: number | null
          avg_sleep: number | null
          avg_stress: number | null
          client_body_fat_percentage: number | null
          client_goal_weight_kg: number | null
          client_id: string
          client_tdee: number | null
          client_weight_kg: number | null
          coach_id: string
          coach_prompt: string
          created_at: string
          deleted_at: string | null
          description: string | null
          effective_from: string
          effective_until: string | null
          frequency_per_week: number
          id: string
          name: string
          phase_id: string | null
          program_duration_weeks: number | null
          recent_adherence_percentage: number | null
          saved_plan_id: string | null
          split_type: string
          status: string
          updated_at: string
        }
        Insert: {
          ai_response_raw?: string | null
          avg_energy?: number | null
          avg_mood?: number | null
          avg_sleep?: number | null
          avg_stress?: number | null
          client_body_fat_percentage?: number | null
          client_goal_weight_kg?: number | null
          client_id: string
          client_tdee?: number | null
          client_weight_kg?: number | null
          coach_id: string
          coach_prompt: string
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          effective_from?: string
          effective_until?: string | null
          frequency_per_week: number
          id?: string
          name?: string
          phase_id?: string | null
          program_duration_weeks?: number | null
          recent_adherence_percentage?: number | null
          saved_plan_id?: string | null
          split_type: string
          status?: string
          updated_at?: string
        }
        Update: {
          ai_response_raw?: string | null
          avg_energy?: number | null
          avg_mood?: number | null
          avg_sleep?: number | null
          avg_stress?: number | null
          client_body_fat_percentage?: number | null
          client_goal_weight_kg?: number | null
          client_id?: string
          client_tdee?: number | null
          client_weight_kg?: number | null
          coach_id?: string
          coach_prompt?: string
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          effective_from?: string
          effective_until?: string | null
          frequency_per_week?: number
          id?: string
          name?: string
          phase_id?: string | null
          program_duration_weeks?: number | null
          recent_adherence_percentage?: number | null
          saved_plan_id?: string | null
          split_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_plans_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_plans_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_plans_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_plans_saved_plan_id_fkey"
            columns: ["saved_plan_id"]
            isOneToOne: false
            referencedRelation: "coach_saved_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      training_sessions: {
        Row: {
          calorie_surplus_percentage: number | null
          calories_calculated_at: string | null
          created_at: string
          day_of_week: string | null
          estimated_calories: number | null
          estimated_duration_minutes: number | null
          focus: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          order_index: number
          plan_id: string
          updated_at: string
        }
        Insert: {
          calorie_surplus_percentage?: number | null
          calories_calculated_at?: string | null
          created_at?: string
          day_of_week?: string | null
          estimated_calories?: number | null
          estimated_duration_minutes?: number | null
          focus?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          order_index?: number
          plan_id: string
          updated_at?: string
        }
        Update: {
          calorie_surplus_percentage?: number | null
          calories_calculated_at?: string | null
          created_at?: string
          day_of_week?: string | null
          estimated_calories?: number | null
          estimated_duration_minutes?: number | null
          focus?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          order_index?: number
          plan_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_sessions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "training_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      wellness_logs: {
        Row: {
          client_id: string
          created_at: string
          daily_log_id: string
          date: string
          energy: number | null
          id: string
          mood: number | null
          sleep: number | null
          stress: number | null
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          daily_log_id: string
          date: string
          energy?: number | null
          id?: string
          mood?: number | null
          sleep?: number | null
          stress?: number | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          daily_log_id?: string
          date?: string
          energy?: number | null
          id?: string
          mood?: number | null
          sleep?: number | null
          stress?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wellness_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wellness_logs_daily_log_id_fkey"
            columns: ["daily_log_id"]
            isOneToOne: true
            referencedRelation: "daily_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wellness_logs_daily_log_id_fkey"
            columns: ["daily_log_id"]
            isOneToOne: true
            referencedRelation: "daily_logs_full"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      daily_logs_full: {
        Row: {
          calorie_surplus_deficit: number | null
          calories_consumed: number | null
          carbs_g: number | null
          client_id: string | null
          created_at: string | null
          date: string | null
          energy: number | null
          fat_g: number | null
          id: string | null
          mood: number | null
          notes: string | null
          nutrition_adherence: string | null
          phase_id: string | null
          protein_g: number | null
          sleep: number | null
          stress: number | null
          target_calories: number | null
          target_carbs_g: number | null
          target_fat_g: number | null
          target_protein_g: number | null
          trained: boolean | null
          training_data: Json | null
          training_session_id: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_logs_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "phases"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      archive_roadmap_atomic: {
        Args: { p_roadmap_id: string }
        Returns: undefined
      }
      calculate_age: { Args: { date_of_birth: string }; Returns: number }
      calculate_client_adherence_stats: {
        Args: { client_uuid: string }
        Returns: {
          actual_count: number
          adherence_rate: number
          expected_count: number
        }[]
      }
      clean_expired_tokens: { Args: never; Returns: undefined }
      create_nutrition_plan_atomic:
        | {
            Args: {
              p_base_weight_kg: number
              p_baseline_calories: number
              p_bmr: number
              p_carb_target_g: number
              p_client_id: string
              p_coach_id: string
              p_custom_calories: number
              p_custom_carb_g: number
              p_custom_fat_g: number
              p_custom_macros_enabled: boolean
              p_custom_protein_g: number
              p_daily_targets: Json
              p_diet_type: string
              p_fat_target_g: number
              p_goal_deadline: string
              p_goal_weight_kg: number
              p_protein_target_g: number
              p_protein_target_g_per_kg: number
              p_regeneration_reason: string
              p_tdee: number
              p_training_volume_hours: string
              p_work_activity_level: string
            }
            Returns: string
          }
        | {
            Args: {
              p_base_weight_kg: number
              p_baseline_calories: number
              p_bmr: number
              p_carb_target_g: number
              p_client_id: string
              p_coach_id: string
              p_custom_calories: number
              p_custom_carb_g: number
              p_custom_fat_g: number
              p_custom_macros_enabled: boolean
              p_custom_protein_g: number
              p_daily_targets: Json
              p_diet_type: string
              p_fat_target_g: number
              p_goal_deadline: string
              p_goal_weight_kg: number
              p_phase_id?: string
              p_protein_target_g: number
              p_protein_target_g_per_kg: number
              p_regeneration_reason: string
              p_tdee: number
              p_training_volume_hours: string
              p_work_activity_level: string
            }
            Returns: string
          }
        | {
            Args: {
              p_base_weight_kg: number
              p_baseline_calories: number
              p_bmr: number
              p_carb_target_g: number
              p_client_id: string
              p_coach_id: string
              p_coach_notes?: string
              p_custom_calories: number
              p_custom_carb_g: number
              p_custom_fat_g: number
              p_custom_macros_enabled: boolean
              p_custom_protein_g: number
              p_daily_targets: Json
              p_diet_type: string
              p_fat_target_g: number
              p_goal_deadline: string
              p_goal_source?: string
              p_goal_weight_kg: number
              p_phase_id?: string
              p_protein_target_g: number
              p_protein_target_g_per_kg: number
              p_regeneration_reason: string
              p_tdee: number
              p_training_volume_hours: string
              p_work_activity_level: string
            }
            Returns: string
          }
        | {
            Args: {
              p_base_weight_kg: number
              p_baseline_calories: number
              p_bmr: number
              p_carb_target_g: number
              p_client_id: string
              p_coach_id: string
              p_coach_notes?: string
              p_custom_calories: number
              p_custom_carb_g: number
              p_custom_fat_g: number
              p_custom_macros_enabled: boolean
              p_custom_protein_g: number
              p_daily_targets: Json
              p_diet_type: string
              p_effective_from?: string
              p_fat_target_g: number
              p_goal_deadline: string
              p_goal_source?: string
              p_goal_weight_kg: number
              p_phase_id?: string
              p_protein_target_g: number
              p_protein_target_g_per_kg: number
              p_regeneration_reason: string
              p_tdee: number
              p_training_volume_hours: string
              p_work_activity_level: string
            }
            Returns: string
          }
      create_training_plan_atomic:
        | {
            Args: {
              p_ai_response_raw: string
              p_avg_energy: number
              p_avg_mood: number
              p_avg_sleep: number
              p_avg_stress: number
              p_client_body_fat_percentage: number
              p_client_goal_weight_kg: number
              p_client_id: string
              p_client_tdee: number
              p_client_weight_kg: number
              p_coach_id: string
              p_coach_prompt: string
              p_description: string
              p_frequency_per_week: number
              p_name: string
              p_phase_id: string
              p_program_duration_weeks: number
              p_recent_adherence_percentage: number
              p_split_type: string
            }
            Returns: string
          }
        | {
            Args: {
              p_ai_response_raw: string
              p_avg_energy: number
              p_avg_mood: number
              p_avg_sleep: number
              p_avg_stress: number
              p_client_body_fat_percentage: number
              p_client_goal_weight_kg: number
              p_client_id: string
              p_client_tdee: number
              p_client_weight_kg: number
              p_coach_id: string
              p_coach_prompt: string
              p_description: string
              p_effective_from?: string
              p_frequency_per_week: number
              p_name: string
              p_phase_id: string
              p_program_duration_weeks: number
              p_recent_adherence_percentage: number
              p_split_type: string
            }
            Returns: string
          }
        | {
            Args: {
              p_ai_response_raw: string
              p_avg_energy: number
              p_avg_mood: number
              p_avg_sleep: number
              p_avg_stress: number
              p_client_body_fat_percentage: number
              p_client_goal_weight_kg: number
              p_client_id: string
              p_client_tdee: number
              p_client_weight_kg: number
              p_coach_id: string
              p_coach_prompt: string
              p_description: string
              p_effective_from?: string
              p_frequency_per_week: number
              p_name: string
              p_phase_id: string
              p_program_duration_weeks: number
              p_recent_adherence_percentage: number
              p_saved_plan_id?: string
              p_split_type: string
            }
            Returns: string
          }
      get_client_exercise_list: {
        Args: {
          p_client_id: string
          p_end_date?: string
          p_start_date?: string
        }
        Returns: {
          exercise_id: string
          last_logged_date: string
          log_count: number
          name: string
        }[]
      }
      get_client_streak: {
        Args: { p_client_id: string; p_start_date: string; p_today: string }
        Returns: {
          current_streak: number
          longest_streak: number
        }[]
      }
      get_exercise_progression_window: {
        Args: {
          p_client_id: string
          p_end_date?: string
          p_exercise_id?: string
          p_exercise_name?: string
          p_session_count?: number
          p_start_date?: string
        }
        Returns: {
          completed_at: string
          exercise_log_id: string
          prescribed_exercise_snapshot: Json
          reps: number
          rpe: number
          session_log_id: string
          set_id: string
          set_number: number
          weight: number
        }[]
      }
      get_exercise_prs: {
        Args: {
          p_client_id: string
          p_exercise_id?: string
          p_exercise_name?: string
        }
        Returns: {
          date: string
          reps: number
          weight: number
        }[]
      }
      transition_phase_atomic: {
        Args: {
          p_archive_habits: boolean
          p_archive_nutrition: boolean
          p_archive_training: boolean
          p_coach_reflection: string
          p_next_action: string
          p_phase_id: string
          p_phase_summary: Json
        }
        Returns: string
      }
      update_client_adherence_stats: {
        Args: { client_uuid: string }
        Returns: undefined
      }
      upsert_daily_log_atomic:
        | {
            Args: {
              p_client_id: string
              p_date: string
              p_notes: string
              p_nutrition: Json
              p_training: Json
              p_wellness: Json
            }
            Returns: string
          }
        | {
            Args: {
              p_client_id: string
              p_date: string
              p_notes: string
              p_nutrition: Json
              p_nutrition_plan_id?: string
              p_training: Json
              p_training_plan_id?: string
              p_wellness: Json
            }
            Returns: string
          }
    }
    Enums: {
      content_type: "video_link" | "hyperlink" | "pdf" | "image" | "document"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      content_type: ["video_link", "hyperlink", "pdf", "image", "document"],
    },
  },
} as const
