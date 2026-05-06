
// Training plan split types
export type TrainingSplitType =
  | "push_pull_legs"
  | "upper_lower"
  | "full_body"
  | "bro_split"
  | "push_pull"
  | "custom";

// Training plan status
export type TrainingPlanStatus = "active" | "archived" | "draft" | "planned";

// Training exercise
export type TrainingExercise = {
  id: string;
  sessionId: string;
  exerciseId: string | null;
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

// Exercise catalog entry
export type Exercise = {
  id: string;
  coachId: string | null;
  name: string;
  muscleGroup: string | null;
  equipment: string | null;
  category: string | null;
  aliases: string[];
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
  // AI-estimated calorie burn (for training sessions)
  estimatedCalories?: number;
  caloriesCalculatedAt?: string;
  // Calorie surplus percentage (overrides plan default when set)
  calorieSurplusPercentage: number | null;
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
  // Date-effective versioning
  effectiveFrom?: string;
  effectiveUntil?: string;
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

// Training event status
export type TrainingEventStatus = 'scheduled' | 'completed' | 'partial' | 'missed' | 'skipped';

// Concrete calendar event for a training session on a specific date
export type TrainingEvent = {
  id: string;
  clientId: string;
  trainingPlanId: string;
  trainingSessionId: string | null;
  date: string;
  sessionName: string;
  sessionFocus: string | null;
  estimatedCalories: number | null;
  status: TrainingEventStatus;
  sessionLogId: string | null;
  isModified: boolean;
  calorieSurplusPercentage: number | null;
  createdAt: string;
  updatedAt: string;
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
};

// AI generated plan structure
export type AIGeneratedPlan = {
  name: string;
  description: string;
  splitType: TrainingSplitType;
  frequencyPerWeek: number;
  programDurationWeeks?: number;
  cycleLength?: number;
  restDayPositions?: number[];
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
  calorieSurplusPercentage?: number | null;
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

// Builder mode for training plan creation
export type BuilderMode = "ai" | "manual" | "saved";

// Manual creation sub-mode
export type ManualCreationMode = "scratch" | "template";

// Quick suggestion for AI prompt
export type QuickSuggestion = {
  id: string;
  label: string;
  prompt: string;
  category: "goal" | "style" | "equipment";
};

// Workout template for manual creation
export type WorkoutTemplate = {
  id: string;
  name: string;
  description: string;
  splitType: TrainingSplitType;
  frequency: number;
  sessions: TemplateSession[];
};

// Template session structure
export type TemplateSession = {
  name: string;
  focus: string;
};

// Manual session being built (before saving)
export type ManualSessionDraft = {
  tempId: string;
  name: string;
  dayOfWeek?: string;
  focus?: string;
  isRest?: boolean;
  exercises: ManualExerciseDraft[];
};

// Manual exercise being built (before saving)
export type ManualExerciseDraft = {
  tempId: string;
  name: string;
  sets: number;
  repsTarget?: string;
  rpeTarget?: number;
  restSeconds?: number;
  notes?: string;
};

// --- Coach Library Types ---

export type SavedPlanStatus = 'draft' | 'saved';

export type SavedPlan = {
  id: string;
  coachId: string;
  name: string;
  description: string | null;
  splitType: string | null;
  frequencyPerWeek: number | null;
  status: SavedPlanStatus;
  cycleLength: number | null;
  restPattern: number[];
  defaultSurplusPercentage: number | null;
  source: string;
  coachPrompt: string | null;
  programDurationWeeks: number | null;
  sessions: SavedSession[];
  createdAt: string;
  updatedAt: string;
};

export type SavedSession = {
  id: string;
  coachId: string;
  savedPlanId: string | null;
  name: string;
  focus: string | null;
  orderIndex: number;
  isRest: boolean;
  estimatedDurationMinutes: number | null;
  calorieSurplusPercentage: number | null;
  notes: string | null;
  sessionType: string;
  exercises: SavedExercise[];
  createdAt: string;
  updatedAt: string;
};

export type SavedExercise = {
  id: string;
  savedSessionId: string;
  exerciseId: string | null;
  name: string;
  orderIndex: number;
  sets: number;
  repsMin: number | null;
  repsMax: number | null;
  repsTarget: string | null;
  rpeTarget: number | null;
  percentage1rm: number | null;
  tempo: string | null;
  restSeconds: number | null;
  supersetGroup: string | null;
  isWarmup: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

// =============================================================================
// Event-keyed training log types (Session 1.1)
// Stable contracts for Session 1.2 (service impl) and 1.3 (API routes).
// =============================================================================

export type LogTrainingEventResponse = {
  sessionLogId: string;
};

// Camel-case mirror of the session_logs row.
export type SessionLog = {
  id: string;
  clientId: string;
  trainingSessionId: string | null;
  completedAt: string;
  completionQuality: 'full' | 'partial' | 'skipped';
  notes: string | null;
  weekStartDate: string;
  prescribedSessionSnapshot: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

// Camel-case mirror of a set_logs row.
export type SetLog = {
  id: string;
  exerciseLogId: string;
  setNumber: number;
  reps: number | null;
  weight: number | null;
  rpe: number | null;
  createdAt: string;
  updatedAt: string;
};

// Camel-case mirror of the exercise_logs row, plus a service-attached `sets`
// array of child set_logs (populated by the reader, not present on the row).
//
// Display-name resolution rule:
//   performedName ?? prescribedExerciseSnapshot?.name ?? "Unknown exercise"
export type ExerciseLog = {
  id: string;
  sessionLogId: string;
  trainingExerciseId: string | null;
  exerciseId: string | null;
  completed: boolean;
  weightUnit: 'lbs' | 'kg';
  notes: string | null;
  performedName: string | null;
  prescribedExerciseSnapshot: Record<string, unknown> | null;
  sets: SetLog[];
  createdAt: string;
  updatedAt: string;
};

// Resolved session/exercise carries a discriminator so consumers know whether
// the row came from a live FK reference or the snapshot fallback. After plan
// edits or session deletions, the live ref may be null while the snapshot
// preserves the prescription as it was at log time.
export type ResolvedSession =
  | { source: 'live'; session: TrainingSession }
  | { source: 'snapshot'; snapshot: Record<string, unknown> };

export type ResolvedExercise =
  | { source: 'live'; exercise: TrainingExercise }
  | { source: 'snapshot'; snapshot: Record<string, unknown> };

// Combined event detail returned by getTrainingEventDetail().
// exerciseLogs is empty when the client used quick log only or hasn't logged yet.
export type TrainingEventDetail = {
  event: TrainingEvent;
  session: ResolvedSession;
  exercises: ResolvedExercise[];
  sessionLog: SessionLog | null;
  exerciseLogs: ExerciseLog[];
};
