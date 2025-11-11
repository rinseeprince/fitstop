// Supabase database types
// These types can be auto-generated using: supabase gen types typescript --local

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
    };
  };
};
