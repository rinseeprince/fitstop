// Intensity levels with corresponding MET modifiers
export type IntensityLevel = "low" | "moderate" | "vigorous";

// Muscle groups for recovery tracking
export type MuscleGroup =
  | "legs"
  | "back"
  | "chest"
  | "shoulders"
  | "arms"
  | "core"
  | "cardio"
  | "grip"
  | "full_body";

// Activity categories
export type ActivityCategory =
  | "team_sports"
  | "endurance"
  | "racquet_sports"
  | "combat_sports"
  | "outdoor"
  | "winter_sports"
  | "water_sports"
  | "flexibility"
  | "recreational"
  | "fitness"
  | "other";

// Activity metadata stored in JSONB column
export type ActivityMetadata = {
  activityName: string;
  intensityLevel: IntensityLevel;
  durationMinutes: number;
  estimatedCalories: number;
  metValue: number;
  recoveryImpact: string;
  recoveryHours: number;
  muscleGroupsImpacted: MuscleGroup[];
};

// Activity suggestion from database
export type ActivitySuggestion = {
  id: string;
  activityName: string;
  category: ActivityCategory;
  defaultMetLow: number;
  defaultMetModerate: number;
  defaultMetVigorous: number;
  muscleGroupsImpacted: MuscleGroup[];
  recoveryNotes?: string;
  popularityScore: number;
};

// AI-generated activity analysis
export type ActivityAnalysis = {
  estimatedCalories: number;
  metValue: number;
  recoveryImpact: string;
  recoveryHours: number;
  muscleGroupsImpacted: MuscleGroup[];
  trainingRecommendations: string[];
};

// Request type for adding external activity
export type AddExternalActivityRequest = {
  activityName: string;
  dayOfWeek: string;
  intensityLevel: IntensityLevel;
  durationMinutes: number;
  notes?: string;
};

// Request type for activity analysis
export type AnalyzeActivityRequest = {
  activityName: string;
  intensityLevel: IntensityLevel;
  durationMinutes: number;
  clientWeightKg: number;
};

// Response type for activity analysis
export type AnalyzeActivityResponse = {
  success: boolean;
  analysis?: ActivityAnalysis;
  errorMessage?: string;
};

// Response type for activity suggestions
export type ActivitySuggestionsResponse = {
  success: boolean;
  suggestions?: ActivitySuggestion[];
  errorMessage?: string;
};

// Database row types for type-safe mapping
export type ActivitySuggestionRow = {
  id: string;
  activity_name: string;
  category: string;
  default_met_low: string | number;
  default_met_moderate: string | number;
  default_met_vigorous: string | number;
  muscle_groups_impacted: MuscleGroup[] | null;
  recovery_notes: string | null;
  popularity_score: number | null;
  created_at: string;
  updated_at: string;
};

export type TrainingSessionRow = {
  id: string;
  plan_id: string;
  name: string;
  day_of_week: string | null;
  order_index: number;
  focus: string | null;
  notes: string | null;
  estimated_duration_minutes: number | null;
  session_type: "training" | "external_activity";
  activity_metadata: ActivityMetadata | null;
  created_at: string;
  updated_at: string;
};

export type TrainingSessionUpdateData = {
  updated_at: string;
  name?: string;
  day_of_week?: string;
  estimated_duration_minutes?: number;
  notes?: string | null;
  activity_metadata?: ActivityMetadata;
};
