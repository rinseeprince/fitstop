
import type { SetSpec, SetType } from "@/utils/exercise-set-specs";

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
  setSpecs?: SetSpec[] | null;
  videoUrl?: string | null;
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
  // Nullable since mig 113: the event->plan FK is ON DELETE SET NULL, so a plan
  // hard-delete (events-as-SOT overhaul, Sessions 2-3) can orphan the event.
  trainingPlanId: string | null;
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

// Lightweight summary for day-summary endpoint (home screen card)
export type TrainingEventSummary = {
  eventId: string;
  // The session the client actually performed (the prescribed one unless they
  // swapped). isAlternative is true when it differs from the prescribed session.
  sessionName: string;
  sessionFocus: string | null;
  completionQuality: "full" | "partial" | "skipped" | null;
  isAlternative: boolean;
  loggedExerciseCount: number;
  prescribedExerciseCount: number;
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
  setSpecs?: SetSpec[] | null;
  videoUrl?: string | null;
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
  setSpecs?: SetSpec[] | null;
  videoUrl?: string | null;
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
export type SavedPlanSource = 'ai' | 'manual';
export type SavedSessionType = 'training';

export type SavedPlan = {
  id: string;
  coachId: string;
  name: string;
  description: string | null;
  splitType: TrainingSplitType | null;
  frequencyPerWeek: number | null;
  status: SavedPlanStatus;
  cycleLength: number | null;
  restPattern: number[];
  defaultSurplusPercentage: number | null;
  source: SavedPlanSource;
  coachPrompt: string | null;
  programDurationWeeks: number | null;
  sessions: SavedSession[];
  createdAt: string;
  updatedAt: string;
};

// Lean list-row for the paginated Programs library — plan scalars + counts
// derived server-side from cycle_length / rest_pattern, with NO nested sessions
// or exercises (the list never renders them). See getSavedPlansPage. splitType
// is free text here (a descriptive focus), stored in the free-string column.
export type SavedPlanListItem = {
  id: string;
  name: string;
  description: string | null;
  splitType: string | null;
  source: SavedPlanSource;
  status: SavedPlanStatus;
  frequencyPerWeek: number | null;
  weekCount: number;
  totalSlots: number;
  restCount: number;
  trainingCount: number;
  createdAt: string;
  updatedAt: string;
};

// Aggregate stats over ALL of a coach's plans, for the Programs stat band —
// decoupled from list pagination (see getSavedPlansSummary).
export type SavedPlansSummary = {
  total: number;
  aiCount: number;
  customCount: number;
  avgWeeks: number | null;
  minWeeks: number;
  maxWeeks: number;
};

export type SavedSession = {
  id: string;
  coachId: string;
  savedPlanId: string | null;
  name: string;
  focus: string | null;
  orderIndex: number;
  // Internal slot ordering within a multi-week program (0-based). The whole
  // program is the repeat unit at apply time; weekIndex carries no calendar-week
  // meaning. Defaults to 0 (single-week / legacy plans).
  weekIndex: number;
  isRest: boolean;
  estimatedDurationMinutes: number | null;
  calorieSurplusPercentage: number | null;
  notes: string | null;
  sessionType: SavedSessionType;
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
  setSpecs: SetSpec[] | null;
  videoUrl: string | null;
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
  // The prescribed training_event this log is keyed to (Session 5.2 event-keyed
  // identity). null for legacy logs never linked to an event, or truly-extra
  // rest-day training that found no matching prescribed event.
  trainingEventId: string | null;
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
  // Coach-prescribed set type, seeded from the prescription's set_specs at log
  // time (set_logs.set_type). Defaults to 'working'.
  setType: SetType;
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

// =============================================================================
// Exercise analytics types (Session 1.8)
// Used by exercise-analytics-service and exercise-history API route.
// =============================================================================

export type ExerciseListItem = {
  exerciseId: string | null;
  name: string;
  logCount: number;
  lastLoggedDate: string;
};

export type ExerciseProgressionPoint = {
  date: string;
  sessionLogId: string;
  topSetWeight: number | null;
  topSetReps: number | null;
  estimatedOneRepMax: number | null;
  totalVolume: number | null;
  topSetRpe: number | null;
  prescribedSets: number | null;
  actualSets: number;
  prescribedRepsMin: number | null;
  prescribedRepsMax: number | null;
};

export type ExercisePR = {
  reps: number;
  weight: number;
  date: string;
  isRecent: boolean;
};
