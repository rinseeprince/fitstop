import type { ActivityMetadata, IntensityLevel, MuscleGroup, ActivityAnalysis } from "./external-activity";

// Training plan split types
export type TrainingSplitType =
  | "push_pull_legs"
  | "upper_lower"
  | "full_body"
  | "bro_split"
  | "push_pull"
  | "custom";

// Session type to distinguish training from external activities
export type SessionType = "training" | "external_activity";

// Training plan status
export type TrainingPlanStatus = "active" | "archived" | "draft";

// Training exercise
export type TrainingExercise = {
  id: string;
  sessionId: string;
  name: string;
  orderIndex: number;
  sets: number;
  repsMin?: number;
  repsMax?: number;
  repsTarget?: string;
  rpeTarget?: number;
  percentage1rm?: number;
  tempo?: string;
  restSeconds?: number;
  notes?: string;
  supersetGroup?: string;
  isWarmup: boolean;
  createdAt: string;
  updatedAt: string;
};

// Training session (workout day) or external activity
export type TrainingSession = {
  id: string;
  planId: string;
  name: string;
  dayOfWeek?: string;
  orderIndex: number;
  focus?: string;
  notes?: string;
  estimatedDurationMinutes?: number;
  exercises: TrainingExercise[];
  // External activity fields
  sessionType: SessionType;
  activityMetadata?: ActivityMetadata;
  // AI-estimated calorie burn (for training sessions)
  estimatedCalories?: number;
  caloriesCalculatedAt?: string;
  createdAt: string;
  updatedAt: string;
};

// Training plan
export type TrainingPlan = {
  id: string;
  clientId: string;
  coachId: string;
  name: string;
  description?: string;
  status: TrainingPlanStatus;
  coachPrompt: string;
  aiResponseRaw?: string;
  splitType: TrainingSplitType;
  frequencyPerWeek: number;
  programDurationWeeks?: number;
  // Client metrics snapshot
  clientWeightKg?: number;
  clientBodyFatPercentage?: number;
  clientGoalWeightKg?: number;
  clientTdee?: number;
  // Check-in data snapshot
  avgMood?: number;
  avgEnergy?: number;
  avgSleep?: number;
  avgStress?: number;
  recentAdherencePercentage?: number;
  sessions: TrainingSession[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

// Training plan history record
export type TrainingPlanHistory = {
  id: string;
  clientId: string;
  planId?: string;
  coachPrompt: string;
  aiResponseRaw?: string;
  planSnapshot: TrainingPlan;
  clientMetricsSnapshot?: {
    weightKg?: number;
    bodyFatPercentage?: number;
    goalWeightKg?: number;
    tdee?: number;
  };
  checkInDataSnapshot?: {
    avgMood?: number;
    avgEnergy?: number;
    avgSleep?: number;
    avgStress?: number;
    adherencePercentage?: number;
  };
  regenerationReason?: string;
  createdByCoachId?: string;
  createdAt: string;
};

// Pre-generation activity (before plan is created)
export type PreGenerationActivity = {
  tempId: string;
  activityName: string;
  dayOfWeek: string;
  intensityLevel: IntensityLevel;
  durationMinutes: number;
  notes?: string;
  analysis?: ActivityAnalysis;
};

// External activity context for AI generation
export type ExternalActivityContext = {
  activityName: string;
  dayOfWeek: string;
  intensityLevel: IntensityLevel;
  durationMinutes: number;
  recoveryHours: number;
  muscleGroupsImpacted: MuscleGroup[];
  recoveryImpact: string;
};

// AI generation input
export type AITrainingPlanInput = {
  coachPrompt: string;
  client: {
    name: string;
    currentWeightKg?: number;
    goalWeightKg?: number;
    bodyFatPercentage?: number;
    goalBodyFatPercentage?: number;
    tdee?: number;
    bmr?: number;
    gender?: "male" | "female" | "other";
  };
  checkInData?: {
    avgMood?: number;
    avgEnergy?: number;
    avgSleep?: number;
    avgStress?: number;
    adherencePercentage?: number;
    recentWorkoutsCompleted?: number;
    recentChallenges?: string;
    recentPRs?: string;
  };
  // External activities as immovable constraints for scheduling
  externalActivities?: ExternalActivityContext[];
  // Allow training sessions on the same day as external activities
  allowSameDayTraining?: boolean;
};

// AI generated plan structure
export type AIGeneratedPlan = {
  name: string;
  description: string;
  splitType: TrainingSplitType;
  frequencyPerWeek: number;
  programDurationWeeks?: number;
  sessions: AIGeneratedSession[];
};

export type AIGeneratedSession = {
  name: string;
  dayOfWeek?: string;
  focus?: string;
  notes?: string;
  estimatedDurationMinutes?: number;
  exercises: AIGeneratedExercise[];
};

export type AIGeneratedExercise = {
  name: string;
  sets: number;
  repsMin?: number;
  repsMax?: number;
  repsTarget?: string;
  rpeTarget?: number;
  percentage1rm?: number;
  tempo?: string;
  restSeconds?: number;
  notes?: string;
  supersetGroup?: string;
  isWarmup?: boolean;
};

// API request/response types
export type GenerateTrainingPlanRequest = {
  coachPrompt: string;
  preGenerationActivities?: PreGenerationActivity[];
  allowSameDayTraining?: boolean;
};

export type GenerateTrainingPlanResponse = {
  success: boolean;
  plan?: TrainingPlan;
  errorMessage?: string;
};

export type GetTrainingPlanResponse = {
  success: boolean;
  plan?: TrainingPlan;
  errorMessage?: string;
};

export type UpdateTrainingPlanRequest = {
  name?: string;
  description?: string | null;
  status?: TrainingPlanStatus;
  frequencyPerWeek?: number;
  programDurationWeeks?: number | null;
};

export type UpdateSessionRequest = {
  name?: string;
  dayOfWeek?: string | null;
  orderIndex?: number;
  focus?: string | null;
  notes?: string | null;
  estimatedDurationMinutes?: number | null;
};

// Bulk reorder request type
export type ReorderSessionItem = {
  sessionId: string;
  dayOfWeek?: string | null;
  orderIndex: number;
};

export type ReorderSessionsRequest = {
  sessions: ReorderSessionItem[];
};

export type UpdateExerciseRequest = {
  name?: string;
  sets?: number;
  repsMin?: number | null;
  repsMax?: number | null;
  repsTarget?: string | null;
  rpeTarget?: number | null;
  percentage1rm?: number | null;
  tempo?: string | null;
  restSeconds?: number | null;
  notes?: string | null;
  supersetGroup?: string | null;
  isWarmup?: boolean;
};

export type AddSessionRequest = {
  name: string;
  dayOfWeek?: string | null;
  focus?: string | null;
  notes?: string | null;
  estimatedDurationMinutes?: number | null;
};

export type AddExerciseRequest = {
  name: string;
  sets: number;
  repsMin?: number | null;
  repsMax?: number | null;
  repsTarget?: string | null;
  rpeTarget?: number | null;
  percentage1rm?: number | null;
  tempo?: string | null;
  restSeconds?: number | null;
  notes?: string | null;
  supersetGroup?: string | null;
  isWarmup?: boolean;
};

export type GetTrainingPlanHistoryResponse = {
  success: boolean;
  history?: TrainingPlanHistory[];
  errorMessage?: string;
};
