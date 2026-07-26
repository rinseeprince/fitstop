import type { DailyLog } from "./daily-log";
import type { OnboardingStatus } from "./client-intake";
import type { TrainingEventStatus } from "@/types/training";

// Check-in status types
export type CheckInStatus = "pending" | "ai_processed" | "reviewed";

// Check-in tracking types
export type CheckInFrequency = "weekly" | "biweekly" | "monthly" | "custom" | "none";

export type DayOfWeek =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type ReminderType = "upcoming" | "overdue" | "follow_up";

export type OverdueSeverity = "upcoming" | "due_soon" | "overdue" | "critically_overdue";

export type ReminderPreferences = {
  enabled: boolean;
  autoSend: boolean;
  sendBeforeHours: number;
};

// Subjective metrics from client check-in
export type SubjectiveMetrics = {
  mood?: number; // 1-5
  energy?: number; // 1-10
  sleep?: number; // 1-10
  stress?: number; // 1-10
  soreness?: number; // 1-10 (higher = more sore)
  notes?: string;
};

// Body measurements and metrics
export type BodyMetrics = {
  weight?: number;
  weightUnit?: "lbs" | "kg";
  bodyFatPercentage?: number;
  waist?: number;
  hips?: number;
  chest?: number;
  arms?: number;
  thighs?: number;
  measurementUnit?: "in" | "cm";
};

// Progress photos
export type ProgressPhotos = {
  photoFront?: string; // URL
  photoSide?: string; // URL
  photoBack?: string; // URL
};

// Training and nutrition metrics (legacy fields for backward compatibility)
export type TrainingMetrics = {
  workoutsCompleted?: number;
  adherencePercentage?: number; // 0-100
  prs?: string; // Personal records/wins
  challenges?: string; // Difficulties faced
};

// Enhanced check-in tracking types

export type SessionCompletionQuality = "full" | "partial" | "skipped";

// Whether a training_event has an associated session_log (Session 6.2).
// Single-source per-event detail keyed on training_events (the SOT for
// completion counting), left-joined to its session_log for notes/quality.
export type TrainingEventLogStatus = "logged" | "not_logged";

export type CheckInTrainingEventDetail = {
  eventId: string;
  date: string;
  sessionName: string;
  status: TrainingEventStatus;
  logStatus: TrainingEventLogStatus;
  notes?: string;
  completionQuality?: SessionCompletionQuality;
  trainingSessionId: string | null;
  // The linked session_log id (null when the event was never logged). Used by
  // the AI prompt to join per-exercise top-set lines (keyed by session_log_id)
  // back to each event (Session 6.3).
  sessionLogId: string | null;
  performedSessionName?: string | null;
};

export type CheckInSessionCompletion = {
  id?: string;
  checkInId?: string;
  trainingSessionId: string | null; // API/UI shape; DERIVED from training_events.status + session_logs (no backing table)
  sessionName: string;
  dayOfWeek?: DayOfWeek;
  completed: boolean;
  completionQuality?: SessionCompletionQuality;
  notes?: string;
};

export type ExerciseHighlightType = "pr" | "struggle" | "note";

export type CheckInExerciseHighlight = {
  id?: string;
  checkInId?: string;
  exerciseId?: string;
  exerciseName: string;
  highlightType: ExerciseHighlightType;
  details?: string;
  weightValue?: number;
  weightUnit?: "lbs" | "kg";
  reps?: number;
};


export type NutritionAdherence = {
  daysOnTarget?: number; // 0-7
  notes?: string;
};

// Context types for check-in form

export type CheckInTrainingContext = {
  hasActivePlan: boolean;
  planId?: string;
  planName?: string;
  sessions: Array<{
    id: string;
    name: string;
    dayOfWeek?: DayOfWeek;
    focus?: string;
    exercises: Array<{
      id: string;
      name: string;
      sets: number;
      repsTarget?: string;
    }>;
  }>;
};

export type CheckInNutritionContext = {
  hasNutritionPlan: boolean;
  weeklyTargets?: Array<{
    day: DayOfWeek;
    dayLabel: string;
    isTrainingDay: boolean;
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  }>;
  averageTargets?: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  };
};

// Enhanced training metrics including new structured data
export type EnhancedTrainingMetrics = TrainingMetrics & {
  sessionCompletions?: CheckInSessionCompletion[];
  exerciseHighlights?: CheckInExerciseHighlight[];
  nutritionAdherence?: NutritionAdherence;
};

// AI-generated insights
export type AIInsight = {
  type: "strength" | "concern" | "trend";
  text: string;
};

// AI-generated recommendations
export type AIRecommendation = {
  priority: "high" | "medium" | "low";
  text: string;
};

// Enhanced AI insight sections
export type AINutritionInsight = {
  weeklyAdherence: string;
  caloriePattern: string;
  keyObservation: string;
};

export type AINotesIntelligence = {
  themes: string[];
  concerns: string[];
  positives: string[];
  rawNotes: { date: string; note: string }[];
};

export type AITrainingInsight = {
  completionSummary: string;
  keyObservation: string;
  progressNote: string;
};

export type AIWellnessInsight = {
  pattern: string;
  averages: string;
  concern?: string;
};

export type AICoachAction = {
  action: string;
  urgency: "now" | "next_check_in" | "monitor";
  context: string;
};

// Enhanced AI data stored in ai_insights JSONB (v2 format)
export type EnhancedAIData = {
  _version: 2;
  insights: AIInsight[];
  nutritionInsight?: AINutritionInsight;
  notesIntelligence?: AINotesIntelligence;
  trainingInsight?: AITrainingInsight;
  wellnessInsight?: AIWellnessInsight;
  coachActions?: AICoachAction[];
  clientHighlights?: string[];
};

// --- Check-in review (v3 AI output) ---

export type WatchItemType = "win" | "risk" | "trend" | "flag";

export type CheckInWatchItem = {
  type: WatchItemType;
  text: string;
};

export type CoachActionPriority = "high" | "medium" | "low";

export type CheckInCoachAction = {
  priority: CoachActionPriority;
  text: string;
};

// The four-block coach review produced by the AI pass. Plain text, no markdown:
// summary (what happened), watchItems + themes (what to watch), coachActions
// (what to do) and clientMessage (what to say).
export type CheckInReview = {
  summary: string;
  watchItems: CheckInWatchItem[];
  themes: string[];
  coachActions: CheckInCoachAction[];
  clientMessage: string;
};

// v3 enhanced data stored in the ai_insights JSONB column. summary and
// clientMessage live in their own columns (ai_summary, ai_response_draft).
export type EnhancedAIDataV3 = {
  _version: 3;
  watchItems: CheckInWatchItem[];
  themes: string[];
  coachActions: CheckInCoachAction[];
};

// Complete check-in record (database row)
export type CheckIn = {
  id: string;
  clientId: string;
  clientName?: string; // Populated when joining with clients table
  clientAvatarUrl?: string | null; // Populated when joining with clients table
  status: CheckInStatus;

  // Subjective
  mood?: number;
  energy?: number;
  sleep?: number;
  stress?: number;
  soreness?: number;
  notes?: string;

  // Body metrics
  weight?: number;
  weightUnit?: "lbs" | "kg";
  bodyFatPercentage?: number;
  waist?: number;
  hips?: number;
  chest?: number;
  arms?: number;
  thighs?: number;
  measurementUnit?: "in" | "cm";

  // Photos
  photoFront?: string;
  photoSide?: string;
  photoBack?: string;

  // Training & nutrition (legacy fields)
  workoutsCompleted?: number;
  adherencePercentage?: number;
  prs?: string;
  challenges?: string;

  // Enhanced nutrition tracking
  nutritionDaysOnTarget?: number;
  nutritionNotes?: string;

  // AI fields
  aiSummary?: string;
  aiInsights?: AIInsight[] | EnhancedAIData | EnhancedAIDataV3;
  aiRecommendations?: AIRecommendation[];
  aiResponseDraft?: string;
  aiProcessedAt?: string;

  // Coach response
  coachResponse?: string;
  coachReviewedAt?: string;
  responseSentAt?: string;

  // Check-in period (fixed 7-day window based on expectedCheckInDay)
  periodStart?: string;
  periodEnd?: string;

  // Frozen period snapshot (training + nutrition day-by-day schedule)
  periodSnapshot?: unknown;

  // Timestamps
  createdAt: string;
  updatedAt: string;
};

// Form data structure for client submission
export type CheckInFormData = SubjectiveMetrics &
  BodyMetrics &
  ProgressPhotos &
  EnhancedTrainingMetrics;

// Token for magic link authentication
export type CheckInToken = {
  id: string;
  clientId: string;
  token: string;
  expiresAt: string;
  usedAt?: string;
  checkInId?: string;
  createdAt: string;
};

// Coach record from database
export type Coach = {
  id: string;
  userId?: string; // Reference to auth.users
  name: string;
  email: string;
  avatarUrl?: string;
  // IANA time zone for coach-local "today" computation, auto-synced from the
  // coach's device on app load (Session 7.81). 'UTC' until first sync.
  timezone: string;
  createdAt: string;
  updatedAt: string;
};

// Nutrition-specific types
export type UnitPreference = "metric" | "imperial";

export type ActivityLevel =
  | "sedentary"
  | "lightly_active"
  | "moderately_active"
  | "very_active"
  | "extremely_active";

export type TrainingVolume = "0-1" | "2-3" | "4-5" | "6-7" | "8+";

export type DietType = "balanced" | "high_carb" | "low_carb" | "keto" | "custom";

export type NutritionEventStatus = "scheduled" | "logged" | "missed";

export type NutritionEvent = {
  id: string;
  clientId: string;
  // Nullable since mig 113: the event->plan FK is ON DELETE SET NULL, so a plan
  // hard-delete (events-as-SOT overhaul, Sessions 2-3) can orphan the event.
  nutritionPlanId: string | null;
  date: string;
  dayOfWeek: string;
  baselineCalories: number;
  trainingBurnCalories: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  dietType: string;
  isTrainingDay: boolean;
  calorieSurplusPercentage: number | null;
  // Coach materialized a per-day override onto this event (mig 113, Session 1).
  // The cascade/regenerate leaves is_modified=true days untouched; reset clears it.
  isModified: boolean;
  // Optional coach per-day note (mig 118). Rides is_modified=true so it survives
  // regen; cleared on reset. Mirrors training_events.session_focus.
  note: string | null;
  status: NutritionEventStatus;
  createdAt: string;
  updatedAt: string;
};

// Client record from database
export type Client = {
  id: string;
  coachId: string;
  name: string;
  email: string;
  avatarUrl?: string;
  notes?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;

  // Static profile fields
  height?: number;
  heightUnit?: "in" | "cm";
  gender?: "male" | "female" | "other";
  dateOfBirth?: string; // ISO date string (YYYY-MM-DD)
  phone?: string;

  // Goal fields (manually set by coach)
  goalWeight?: number;
  goalBodyFatPercentage?: number;
  goalDeadline?: string;
  weightUnit?: "lbs" | "kg";

  // Starting metrics (original intake values for goal tracking)
  startingWeight?: number;
  startingBodyFatPercentage?: number;

  // Current metrics (automatically updated from latest check-in)
  currentWeight?: number;
  currentBodyFatPercentage?: number;

  // Calculated fields
  bmr?: number;
  tdee?: number;

  // Check-in tracking fields
  checkInFrequency?: CheckInFrequency;
  checkInFrequencyDays?: number;
  expectedCheckInDay?: DayOfWeek;
  lastReminderSentAt?: string;
  reminderPreferences?: ReminderPreferences;

  // Adherence tracking fields
  totalCheckInsExpected?: number;
  totalCheckInsCompleted?: number;
  checkInAdherenceRate?: number;
  currentStreak?: number;
  longestStreak?: number;

  // Display preferences (remain on clients table)
  unitPreference?: UnitPreference;
  includeActivityBurn: boolean;
  // How a training-day surplus distributes across macros (mig 117): false = keep
  // the plan's carb:fat ratio (protein held); true = carbs only (protein+fat held).
  surplusAsCarbs: boolean;

  // Activation
  welcomeMessage?: string;

  // Manual BMR/TDEE overrides
  bmrManualOverride?: boolean;
  tdeeManualOverride?: boolean;

  // Onboarding
  onboardingStatus?: OnboardingStatus;
  walkthroughCompletedAt?: string;
  startDate?: string;

  // IANA time zone for client-local "today" computation
  timezone: string;
};

// Calorie skewing types
export type DayCalorieOverride = {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

export type DayCalorieOverrides = Record<DayOfWeek, DayCalorieOverride>;

// Client info for check-in page
export type CheckInClientInfo = {
  id: string;
  name: string;
  email: string;
  coachName: string;
  checkInFrequencyDays?: number; // 7 for weekly, 14 for bi-weekly, etc.
  lastCheckInDate?: string; // ISO date string (YYYY-MM-DD) of last check-in
  // Client's IANA timezone — used by the check-in form to compute "today" for
  // canEditDay (Session 6.4). Optional for back-compat with the legacy token flow.
  timezone?: string;
};

// Request/Response types for API

export type CreateCheckInTokenRequest = {
  clientId: string;
};

export type CreateCheckInTokenResponse = {
  token: string;
  link: string;
  expiresAt: string;
};

export type ValidateCheckInTokenResponse = {
  valid: boolean;
  clientInfo?: CheckInClientInfo;
  trainingContext?: CheckInTrainingContext;
  nutritionContext?: CheckInNutritionContext;
  dailyLogs?: DailyLog[];
  errorMessage?: string;
};

export type SubmitCheckInRequest = CheckInFormData & {
  token: string;
};

export type SubmitCheckInResponse = {
  success: boolean;
  checkInId?: string;
  errorMessage?: string;
};

export type GenerateAISummaryRequest = {
  checkInId: string;
};

export type GenerateAISummaryResponse = {
  success: boolean;
  summary?: CheckInReview;
  errorMessage?: string;
};

export type ReviewCheckInRequest = {
  coachResponse: string;
};

export type ReviewCheckInResponse = {
  success: boolean;
  errorMessage?: string;
};

export type GetCheckInsResponse = {
  checkIns: CheckIn[];
  total: number;
};

// Progress comparison data
export type ProgressComparison = {
  current: CheckIn;
  previous?: CheckIn;
  changes: {
    weight?: number;
    bodyFatPercentage?: number;
    measurements?: {
      waist?: number;
      hips?: number;
      chest?: number;
      arms?: number;
      thighs?: number;
    };
    adherence?: number;
  };
};

// Chart data for visualizations
export type ChartDataPoint = {
  date: string;
  value: number;
  label?: string;
};

export type ProgressChartData = {
  weight: ChartDataPoint[];
  bodyFat: ChartDataPoint[];
  adherence: ChartDataPoint[];
  mood: ChartDataPoint[];
  energy: ChartDataPoint[];
  sleep: ChartDataPoint[];
  stress: ChartDataPoint[];
  soreness: ChartDataPoint[];
};

// Check-in reminder record
export type CheckInReminder = {
  id: string;
  clientId: string;
  sentAt: string;
  reminderType: ReminderType;
  daysOverdue: number | null;
  responded: boolean;
  respondedAt?: string;
  checkInId?: string;
  sentVia: "system" | "manual";
  notes?: string;
  createdAt: string;
};

// Extended client types for tracking
export type ClientWithCheckInInfo = Client & {
  lastCheckInDate?: string;
  lastCheckInPeriodEnd?: string;
  engagement?: "high" | "medium" | "low";
};

export type OverdueClient = Client & {
  nextExpectedCheckIn: Date | null;
  daysOverdue: number;
  severity: OverdueSeverity;
  lastCheckInDate?: string;
};

export type ClientDueSoon = Client & {
  nextExpectedCheckIn: Date | null;
  daysUntilDue: number;
  lastCheckInDate?: string;
};

export type ClientCheckInConfig = {
  checkInFrequency: CheckInFrequency;
  checkInFrequencyDays?: number;
  expectedCheckInDay?: DayOfWeek | null;
  reminderPreferences: ReminderPreferences;
};

export type ClientAdherenceStats = {
  totalCheckInsExpected: number;
  totalCheckInsCompleted: number;
  checkInAdherenceRate: number;
  currentStreak: number;
  longestStreak: number;
};

// API Request/Response types for tracking features

export type GetOverdueClientsResponse = {
  clients: OverdueClient[];
  total: number;
};

export type GetClientsDueSoonResponse = {
  clients: ClientDueSoon[];
  total: number;
};

export type SendReminderRequest = {
  reminderType?: ReminderType;
};

export type SendReminderResponse = {
  success: boolean;
  reminderId?: string;
  errorMessage?: string;
};

export type UpdateCheckInConfigRequest = ClientCheckInConfig;

export type UpdateCheckInConfigResponse = {
  success: boolean;
  client?: Client;
  errorMessage?: string;
};

export type GetClientRemindersResponse = {
  reminders: CheckInReminder[];
  total: number;
};


// Nutrition calculation request/response types
export type GenerateNutritionPlanRequest = {
  workActivityLevel: ActivityLevel;
  trainingVolumeHours: TrainingVolume;
  proteinTargetGPerKg: number;
  dietType: DietType;
  goalDeadline?: string;
  customMacrosEnabled?: boolean;
  customProteinG?: number;
  customCarbG?: number;
  customFatG?: number;
  customCalories?: number;
  coachNotes?: string;
  effectiveFrom?: string;
  preserveCalories?: boolean;
  dayCalorieOverrides?: DayCalorieOverrides;
};

export type GenerateNutritionPlanResponse = {
  success: boolean;
  plan?: {
    calorieTarget: number;
    proteinTargetG: number;
    carbTargetG: number;
    fatTargetG: number;
    adjustedTdee: number;
    weeklyWeightChangeKg: number;
    warnings?: string[];
  };
  errorMessage?: string;
};

// Trend direction for metrics
export type TrendDirection = "up" | "down" | "stable";

// Metric change with trend
export type MetricChange = {
  current?: number;
  previous?: number;
  change?: number;
  percentChange?: number;
  trend?: TrendDirection;
};

// Comprehensive check-in comparison data
export type CheckInComparison = {
  current: CheckIn;
  previous: CheckIn | null;
  client: {
    id: string;
    name: string;
    goalWeight?: number;
    goalBodyFatPercentage?: number;
    goalDeadline?: string;
    currentWeight?: number;
    currentBodyFatPercentage?: number;
    weightUnit?: "lbs" | "kg";
    unitPreference?: UnitPreference;
    nutritionPlanBaseWeightKg?: number;
    nutritionPlanCreatedDate?: string;
  };
  changes: {
    weight?: MetricChange;
    bodyFatPercentage?: MetricChange;
    waist?: MetricChange;
    hips?: MetricChange;
    chest?: MetricChange;
    arms?: MetricChange;
    thighs?: MetricChange;
    workoutsCompleted?: MetricChange;
    adherencePercentage?: MetricChange;
    mood?: MetricChange;
    energy?: MetricChange;
    sleep?: MetricChange;
    stress?: MetricChange;
    soreness?: MetricChange;
  };
  timeBetweenCheckIns?: number; // days
};

// Pace-aware goal status: whether the rate required to hit the goal by the
// deadline is within a safe weekly ceiling.
export type GoalPaceStatus = "on_track" | "behind_pace" | "unrealistic";

// Goal progress tracking
export type GoalProgress = {
  weight?: {
    current: number;
    goal: number;
    startingWeight?: number;
    remaining: number;
    percentComplete: number;
    unit: "lbs" | "kg";
    isOnTrack: boolean;
    projectedCompletionDate?: string;
    avgWeeklyChange?: number;
    weeksToGoal?: number;
    // Pace check vs deadline (undefined when there is no deadline / current weight).
    paceStatus?: GoalPaceStatus;
    requiredRate?: number;
    safeCeiling?: number;
  };
  bodyFat?: {
    current: number;
    goal: number;
    startingBodyFat?: number;
    remaining: number;
    percentComplete: number;
    isOnTrack: boolean;
    avgChange?: number;
  };
  deadline?: {
    date: string;
    daysRemaining: number;
    isPastDeadline: boolean;
  };
};

// Complete comparison response with goal tracking
export type GetCheckInComparisonResponse = {
  comparison: CheckInComparison;
  goalProgress: GoalProgress;
  chartData: ProgressChartData;
};

// Metric update types
export type MetricSaveOption = "check-in" | "update-only";

export type UpdateClientMetricsRequest = {
  currentWeight?: number;
  currentBodyFatPercentage?: number;
  goalWeight?: number;
  goalBodyFatPercentage?: number;
  bmr?: number;
  tdee?: number;
  bmrManualOverride?: boolean;
  tdeeManualOverride?: boolean;
  saveOption?: MetricSaveOption;
};

// Check-in enriched with daily log counts for timeline display
export type CheckInWithDailyLogCounts = CheckIn & {
  dailyLogsCount: number;
  expectedDays: number;
};

// Check-in with all related details for AI processing
export type CheckInWithDetails = CheckIn & {
  sessionCompletions?: CheckInSessionCompletion[];
  exerciseHighlights?: CheckInExerciseHighlight[];
};
