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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      activity_suggestions: {
        Row: {
          activity_name: string
          category: string
          created_at: string
          default_met_low: number
          default_met_moderate: number
          default_met_vigorous: number
          id: string
          muscle_groups_impacted: string[] | null
          popularity_score: number | null
          recovery_notes: string | null
          updated_at: string
        }
        Insert: {
          activity_name: string
          category: string
          created_at?: string
          default_met_low: number
          default_met_moderate: number
          default_met_vigorous: number
          id?: string
          muscle_groups_impacted?: string[] | null
          popularity_score?: number | null
          recovery_notes?: string | null
          updated_at?: string
        }
        Update: {
          activity_name?: string
          category?: string
          created_at?: string
          default_met_low?: number
          default_met_moderate?: number
          default_met_vigorous?: number
          id?: string
          muscle_groups_impacted?: string[] | null
          popularity_score?: number | null
          recovery_notes?: string | null
          updated_at?: string
        }
        Relationships: []
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
      check_in_external_activities: {
        Row: {
          activity_name: string
          check_in_id: string
          created_at: string
          day_performed: string | null
          duration_minutes: number
          estimated_calories: number | null
          id: string
          intensity_level: string
          notes: string | null
        }
        Insert: {
          activity_name: string
          check_in_id: string
          created_at?: string
          day_performed?: string | null
          duration_minutes: number
          estimated_calories?: number | null
          id?: string
          intensity_level: string
          notes?: string | null
        }
        Update: {
          activity_name?: string
          check_in_id?: string
          created_at?: string
          day_performed?: string | null
          duration_minutes?: number
          estimated_calories?: number | null
          id?: string
          intensity_level?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "check_in_external_activities_check_in_id_fkey"
            columns: ["check_in_id"]
            isOneToOne: false
            referencedRelation: "check_ins"
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
      check_in_session_completions: {
        Row: {
          check_in_id: string
          completed: boolean
          completion_quality: string | null
          created_at: string
          id: string
          notes: string | null
          training_session_id: string
        }
        Insert: {
          check_in_id: string
          completed?: boolean
          completion_quality?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          training_session_id: string
        }
        Update: {
          check_in_id?: string
          completed?: boolean
          completion_quality?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          training_session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "check_in_session_completions_check_in_id_fkey"
            columns: ["check_in_id"]
            isOneToOne: false
            referencedRelation: "check_ins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_in_session_completions_training_session_id_fkey"
            columns: ["training_session_id"]
            isOneToOne: false
            referencedRelation: "training_sessions"
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
      client_exercise_completions: {
        Row: {
          actual_reps: string | null
          actual_sets: number | null
          actual_weight: number | null
          completed: boolean | null
          created_at: string
          id: string
          notes: string | null
          session_completion_id: string
          training_exercise_id: string
          updated_at: string
          weight_unit: string | null
        }
        Insert: {
          actual_reps?: string | null
          actual_sets?: number | null
          actual_weight?: number | null
          completed?: boolean | null
          created_at?: string
          id?: string
          notes?: string | null
          session_completion_id: string
          training_exercise_id: string
          updated_at?: string
          weight_unit?: string | null
        }
        Update: {
          actual_reps?: string | null
          actual_sets?: number | null
          actual_weight?: number | null
          completed?: boolean | null
          created_at?: string
          id?: string
          notes?: string | null
          session_completion_id?: string
          training_exercise_id?: string
          updated_at?: string
          weight_unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_exercise_completions_session_completion_id_fkey"
            columns: ["session_completion_id"]
            isOneToOne: false
            referencedRelation: "client_session_completions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_exercise_completions_training_exercise_id_fkey"
            columns: ["training_exercise_id"]
            isOneToOne: false
            referencedRelation: "training_exercises"
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
      client_session_completions: {
        Row: {
          client_id: string
          completed_at: string
          completion_quality: string | null
          created_at: string
          id: string
          notes: string | null
          training_session_id: string
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
          training_session_id: string
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
          training_session_id?: string
          updated_at?: string
          week_start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_session_completions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_session_completions_training_session_id_fkey"
            columns: ["training_session_id"]
            isOneToOne: false
            referencedRelation: "training_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          active: boolean | null
          avatar_url: string | null
          baseline_calories: number | null
          bmr: number | null
          bmr_manual_override: boolean | null
          calorie_target: number | null
          carb_target_g: number | null
          check_in_adherence_rate: number | null
          check_in_frequency: string | null
          check_in_frequency_days: number | null
          coach_id: string
          created_at: string | null
          current_body_fat_percentage: number | null
          current_streak: number | null
          current_weight: number | null
          custom_calories: number | null
          custom_carb_g: number | null
          custom_fat_g: number | null
          custom_macros_enabled: boolean | null
          custom_protein_g: number | null
          date_of_birth: string | null
          diet_type: string | null
          email: string
          expected_check_in_day: string | null
          fat_target_g: number | null
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
          nutrition_plan_base_weight_kg: number | null
          nutrition_plan_created_date: string | null
          protein_target_g: number | null
          protein_target_g_per_kg: number | null
          reminder_preferences: Json | null
          starting_body_fat_percentage: number | null
          starting_weight: number | null
          tdee: number | null
          tdee_manual_override: boolean | null
          total_check_ins_completed: number | null
          total_check_ins_expected: number | null
          training_volume_hours: string | null
          unit_preference: string | null
          updated_at: string | null
          user_id: string | null
          weight_unit: string | null
          work_activity_level: string | null
        }
        Insert: {
          active?: boolean | null
          avatar_url?: string | null
          baseline_calories?: number | null
          bmr?: number | null
          bmr_manual_override?: boolean | null
          calorie_target?: number | null
          carb_target_g?: number | null
          check_in_adherence_rate?: number | null
          check_in_frequency?: string | null
          check_in_frequency_days?: number | null
          coach_id: string
          created_at?: string | null
          current_body_fat_percentage?: number | null
          current_streak?: number | null
          current_weight?: number | null
          custom_calories?: number | null
          custom_carb_g?: number | null
          custom_fat_g?: number | null
          custom_macros_enabled?: boolean | null
          custom_protein_g?: number | null
          date_of_birth?: string | null
          diet_type?: string | null
          email: string
          expected_check_in_day?: string | null
          fat_target_g?: number | null
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
          nutrition_plan_base_weight_kg?: number | null
          nutrition_plan_created_date?: string | null
          protein_target_g?: number | null
          protein_target_g_per_kg?: number | null
          reminder_preferences?: Json | null
          starting_body_fat_percentage?: number | null
          starting_weight?: number | null
          tdee?: number | null
          tdee_manual_override?: boolean | null
          total_check_ins_completed?: number | null
          total_check_ins_expected?: number | null
          training_volume_hours?: string | null
          unit_preference?: string | null
          updated_at?: string | null
          user_id?: string | null
          weight_unit?: string | null
          work_activity_level?: string | null
        }
        Update: {
          active?: boolean | null
          avatar_url?: string | null
          baseline_calories?: number | null
          bmr?: number | null
          bmr_manual_override?: boolean | null
          calorie_target?: number | null
          carb_target_g?: number | null
          check_in_adherence_rate?: number | null
          check_in_frequency?: string | null
          check_in_frequency_days?: number | null
          coach_id?: string
          created_at?: string | null
          current_body_fat_percentage?: number | null
          current_streak?: number | null
          current_weight?: number | null
          custom_calories?: number | null
          custom_carb_g?: number | null
          custom_fat_g?: number | null
          custom_macros_enabled?: boolean | null
          custom_protein_g?: number | null
          date_of_birth?: string | null
          diet_type?: string | null
          email?: string
          expected_check_in_day?: string | null
          fat_target_g?: number | null
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
          nutrition_plan_base_weight_kg?: number | null
          nutrition_plan_created_date?: string | null
          protein_target_g?: number | null
          protein_target_g_per_kg?: number | null
          reminder_preferences?: Json | null
          starting_body_fat_percentage?: number | null
          starting_weight?: number | null
          tdee?: number | null
          tdee_manual_override?: boolean | null
          total_check_ins_completed?: number | null
          total_check_ins_expected?: number | null
          training_volume_hours?: string | null
          unit_preference?: string | null
          updated_at?: string | null
          user_id?: string | null
          weight_unit?: string | null
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
      coaches: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string
          id: string
          name: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email: string
          id?: string
          name: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string
          id?: string
          name?: string
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
      daily_external_activities: {
        Row: {
          activity_name: string
          client_id: string
          created_at: string
          date: string
          duration_minutes: number
          estimated_calories: number | null
          id: string
          intensity_level: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          activity_name: string
          client_id: string
          created_at?: string
          date: string
          duration_minutes: number
          estimated_calories?: number | null
          id?: string
          intensity_level: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          activity_name?: string
          client_id?: string
          created_at?: string
          date?: string
          duration_minutes?: number
          estimated_calories?: number | null
          id?: string
          intensity_level?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_external_activities_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          }
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
          }
        ]
      }
      daily_habits: {
        Row: {
          client_id: string
          coach_id: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_boolean: boolean
          name: string
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
          id?: string
          is_active?: boolean
          is_boolean?: boolean
          name: string
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
          id?: string
          is_active?: boolean
          is_boolean?: boolean
          name?: string
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
          }
        ]
      }
      daily_logs: {
        Row: {
          calorie_surplus_deficit: number | null
          calories_consumed: number | null
          carbs_g: number | null
          client_id: string
          completed_activity_ids: Json | null
          created_at: string
          date: string
          energy: number | null
          fat_g: number | null
          id: string
          mood: number | null
          notes: string | null
          nutrition_adherence: string | null
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
          updated_at: string
        }
        Insert: {
          calorie_surplus_deficit?: number | null
          calories_consumed?: number | null
          carbs_g?: number | null
          client_id: string
          completed_activity_ids?: Json | null
          created_at?: string
          date: string
          energy?: number | null
          fat_g?: number | null
          id?: string
          mood?: number | null
          notes?: string | null
          nutrition_adherence?: string | null
          protein_g?: number | null
          sleep?: number | null
          stress?: number | null
          target_calories?: number | null
          target_carbs_g?: number | null
          target_fat_g?: number | null
          target_protein_g?: number | null
          trained?: boolean | null
          training_data?: Json | null
          training_session_id?: string | null
          updated_at?: string
        }
        Update: {
          calorie_surplus_deficit?: number | null
          completed_activity_ids?: Json | null
          training_data?: Json | null
          calories_consumed?: number | null
          carbs_g?: number | null
          client_id?: string
          created_at?: string
          date?: string
          energy?: number | null
          fat_g?: number | null
          id?: string
          mood?: number | null
          notes?: string | null
          nutrition_adherence?: string | null
          protein_g?: number | null
          sleep?: number | null
          stress?: number | null
          target_calories?: number | null
          target_carbs_g?: number | null
          target_fat_g?: number | null
          target_protein_g?: number | null
          trained?: boolean | null
          training_session_id?: string | null
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
            foreignKeyName: "daily_logs_training_session_id_fkey"
            columns: ["training_session_id"]
            isOneToOne: false
            referencedRelation: "training_sessions"
            referencedColumns: ["id"]
          }
        ]
      }
      nutrition_daily_goals: {
        Row: {
          actual_calories: number | null
          calorie_target: number
          carbs_g: number | null
          client_id: string
          completed_at: string | null
          completion_quality: string | null
          created_at: string
          day_of_week: string
          fat_g: number | null
          id: string
          is_completed: boolean | null
          is_training_day: boolean | null
          notes: string | null
          protein_g: number | null
          training_calorie_adjustment: number | null
          updated_at: string
          week_start_date: string
        }
        Insert: {
          actual_calories?: number | null
          calorie_target: number
          carbs_g?: number | null
          client_id: string
          completed_at?: string | null
          completion_quality?: string | null
          created_at?: string
          day_of_week: string
          fat_g?: number | null
          id?: string
          is_completed?: boolean | null
          is_training_day?: boolean | null
          notes?: string | null
          protein_g?: number | null
          training_calorie_adjustment?: number | null
          updated_at?: string
          week_start_date: string
        }
        Update: {
          actual_calories?: number | null
          calorie_target?: number
          carbs_g?: number | null
          client_id?: string
          completed_at?: string | null
          completion_quality?: string | null
          created_at?: string
          day_of_week?: string
          fat_g?: number | null
          id?: string
          is_completed?: boolean | null
          is_training_day?: boolean | null
          notes?: string | null
          protein_g?: number | null
          training_calorie_adjustment?: number | null
          updated_at?: string
          week_start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "nutrition_daily_goals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      nutrition_plan_history: {
        Row: {
          base_weight_kg: number
          bmr: number | null
          calorie_target: number
          carb_target_g: number
          client_id: string
          created_at: string
          created_by_coach_id: string | null
          diet_type: string
          fat_target_g: number
          goal_deadline: string | null
          goal_weight_kg: number | null
          id: string
          protein_target_g: number
          protein_target_g_per_kg: number
          regeneration_reason: string | null
          tdee: number | null
          training_volume_hours: string
          work_activity_level: string
        }
        Insert: {
          base_weight_kg: number
          bmr?: number | null
          calorie_target: number
          carb_target_g: number
          client_id: string
          created_at?: string
          created_by_coach_id?: string | null
          diet_type: string
          fat_target_g: number
          goal_deadline?: string | null
          goal_weight_kg?: number | null
          id?: string
          protein_target_g: number
          protein_target_g_per_kg: number
          regeneration_reason?: string | null
          tdee?: number | null
          training_volume_hours: string
          work_activity_level: string
        }
        Update: {
          base_weight_kg?: number
          bmr?: number | null
          calorie_target?: number
          carb_target_g?: number
          client_id?: string
          created_at?: string
          created_by_coach_id?: string | null
          diet_type?: string
          fat_target_g?: number
          goal_deadline?: string | null
          goal_weight_kg?: number | null
          id?: string
          protein_target_g?: number
          protein_target_g_per_kg?: number
          regeneration_reason?: string | null
          tdee?: number | null
          training_volume_hours?: string
          work_activity_level?: string
        }
        Relationships: [
          {
            foreignKeyName: "nutrition_plan_history_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nutrition_plan_history_created_by_coach_id_fkey"
            columns: ["created_by_coach_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
        ]
      }
      nutrition_weekly_summaries: {
        Row: {
          client_id: string
          completion_percentage: number | null
          created_at: string
          days_completed: number | null
          id: string
          rest_days_per_week: number | null
          total_days: number | null
          training_days_per_week: number | null
          updated_at: string
          week_start_date: string
          weekly_calorie_target: number
          weekly_carbs_target_g: number | null
          weekly_fat_target_g: number | null
          weekly_protein_target_g: number | null
        }
        Insert: {
          client_id: string
          completion_percentage?: number | null
          created_at?: string
          days_completed?: number | null
          id?: string
          rest_days_per_week?: number | null
          total_days?: number | null
          training_days_per_week?: number | null
          updated_at?: string
          week_start_date: string
          weekly_calorie_target: number
          weekly_carbs_target_g?: number | null
          weekly_fat_target_g?: number | null
          weekly_protein_target_g?: number | null
        }
        Update: {
          client_id?: string
          completion_percentage?: number | null
          created_at?: string
          days_completed?: number | null
          id?: string
          rest_days_per_week?: number | null
          total_days?: number | null
          training_days_per_week?: number | null
          updated_at?: string
          week_start_date?: string
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
      training_exercises: {
        Row: {
          created_at: string
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
          session_id: string
          sets: number
          superset_group: string | null
          tempo: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
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
          session_id: string
          sets: number
          superset_group?: string | null
          tempo?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
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
          session_id?: string
          sets?: number
          superset_group?: string | null
          tempo?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_exercises_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "training_sessions"
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
          frequency_per_week: number
          id: string
          name: string
          program_duration_weeks: number | null
          recent_adherence_percentage: number | null
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
          frequency_per_week: number
          id?: string
          name?: string
          program_duration_weeks?: number | null
          recent_adherence_percentage?: number | null
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
          frequency_per_week?: number
          id?: string
          name?: string
          program_duration_weeks?: number | null
          recent_adherence_percentage?: number | null
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
        ]
      }
      training_sessions: {
        Row: {
          activity_metadata: Json | null
          calories_calculated_at: string | null
          created_at: string
          day_of_week: string | null
          estimated_calories: number | null
          estimated_duration_minutes: number | null
          focus: string | null
          id: string
          name: string
          notes: string | null
          order_index: number
          plan_id: string
          session_type: string
          updated_at: string
        }
        Insert: {
          activity_metadata?: Json | null
          calories_calculated_at?: string | null
          created_at?: string
          day_of_week?: string | null
          estimated_calories?: number | null
          estimated_duration_minutes?: number | null
          focus?: string | null
          id?: string
          name: string
          notes?: string | null
          order_index?: number
          plan_id: string
          session_type?: string
          updated_at?: string
        }
        Update: {
          activity_metadata?: Json | null
          calories_calculated_at?: string | null
          created_at?: string
          day_of_week?: string | null
          estimated_calories?: number | null
          estimated_duration_minutes?: number | null
          focus?: string | null
          id?: string
          name?: string
          notes?: string | null
          order_index?: number
          plan_id?: string
          session_type?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
      generate_weekly_nutrition_goals: {
        Args: { p_client_id: string; p_week_start_date: string }
        Returns: undefined
      }
      update_client_adherence_stats: {
        Args: { client_uuid: string }
        Returns: undefined
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
  public: {
    Enums: {
      content_type: ["video_link", "hyperlink", "pdf", "image", "document"],
    },
  },
} as const
