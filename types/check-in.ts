import type { DailyLog } from "./daily-log";
import type { OnboardingStatus } from "./client-intake";
import type { TrainingEventStatus } from "@/types/training";
import type { GoalStatus } from "@/utils/comparison-utils";

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

// Body measurements and metrics.
//
// weightUnit / measurementUnit are DELIBERATELY RETAINED. They are not display
// shims like the ones removed from CheckIn and Client — they are the check-in
// FORM's wire tags, written by components/check-in/step-metrics.tsx's toggles
// and consumed by utils/check-in-canonical-metrics.ts, which converts the
// submission to canonical kg/cm. They are REQUIRED wire tags (CONVENTIONS §20 —
// the RN client logs in its own unit) and stay for as long as that form does.
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
type TrainingMetrics = {
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
type TrainingEventLogStatus = "logged" | "not_logged";

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


type NutritionAdherence = {
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
type AINutritionInsight = {
  weeklyAdherence: string;
  caloriePattern: string;
  keyObservation: string;
};

type AINotesIntelligence = {
  themes: string[];
  concerns: string[];
  positives: string[];
  rawNotes: { date: string; note: string }[];
};

type AITrainingInsight = {
  completionSummary: string;
  keyObservation: string;
  progressNote: string;
};

type AIWellnessInsight = {
  pattern: string;
  averages: string;
  concern?: string;
};

type AICoachAction = {
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
  bodyFatPercentage?: number;
  waist?: number;
  hips?: number;
  chest?: number;
  arms?: number;
  thighs?: number;

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

  // Check-in period (fixed 7-day window ending on the client's check-in weekday)
  periodStart?: string;
  periodEnd?: string;

  // Frozen period snapshot (training + nutrition day-by-day schedule)
  periodSnapshot?: unknown;

  // Timestamps
  createdAt: string;
  updatedAt: string;
};

// Form data structure for client submission
export type CheckInCustomAnswers = {
  customAnswers?: CheckInCustomAnswerInput[];
};

export type CheckInFormData = SubjectiveMetrics &
  BodyMetrics &
  ProgressPhotos &
  EnhancedTrainingMetrics &
  CheckInCustomAnswers;

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
  // The coach's OWN display units, independent of any client's (migration 140).
  // NOT NULL in the database with a 'metric' default, so this is never optional.
  unitPreference: UnitPreference;
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
  // Optional per-day note (mig 118) SHOWN TO THE CLIENT. Rides is_modified=true
  // so it survives regen; cleared on reset. Authored in the calendar's
  // Edit-targets sheet.
  note: string | null;
  // COACH-PRIVATE note (mig 139), written by the plan builder onto the date a
  // change takes effect. Never returned by /api/client/** — every client route
  // that reaches an event builds a new object literal rather than spreading
  // one, which is the only thing keeping it off the wire. Survives the cascade
  // in its own right (it does NOT need is_modified, unlike `note`).
  coachNote: string | null;
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

  // Static profile fields. `height` is canonical CENTIMETRES; there is no
  // companion unit tag, because the unit belongs to whoever is reading the
  // number, not to the row (CONVENTIONS.md §20 Units).
  height?: number;
  gender?: "male" | "female" | "other";
  dateOfBirth?: string; // ISO date string (YYYY-MM-DD)
  phone?: string;
  /** How active the client's daily life is, independent of training. A CLIENT
   *  fact: it drives their TDEE and nothing under the nutrition builder writes
   *  it. Undefined means never set — the calculator falls back to sedentary. */
  workActivityLevel?: ActivityLevel;

  // Goal fields (manually set by coach). The denormalized `clients` mirror of
  // `client_goals`; read only through `toClientGoalInput`, never directly.
  //
  // There is deliberately NO `goalDeadline` here. `mapClientRow` never mapped
  // `clients.goal_deadline`, so the field was permanently `undefined` and the
  // three `?? client.goalDeadline` fallbacks that read it were unreachable.
  // Deleted rather than mapped (owner decision 2026-08-12): mapping it would
  // have made a mirror deadline that can silently diverge — updateGoals' mirror
  // write is logged-and-swallowed — reachable in three calculator/pace paths for
  // the first time. The deadline resolves from `client_goals` only.
  goalWeight?: number;
  goalBodyFatPercentage?: number;

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
  /**
   * `clients.next_check_in_due` (YYYY-MM-DD). The ONE stored fact behind the
   * schedule: overdue is this date in the past, and the reporting week is the
   * seven days ending on the most recent occurrence of its weekday
   * (`checkInWeekday`). Undefined means no schedule.
   */
  nextCheckInDue?: string;
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

// Client info for check-in page
export type CheckInClientInfo = {
  id: string;
  name: string;
  email: string;
  coachName: string;
  checkInFrequencyDays?: number; // 7 for weekly, 14 for bi-weekly, etc.
  lastCheckInDate?: string; // ISO date string (YYYY-MM-DD) of last check-in
  // Client's IANA timezone — used by the check-in form to compute "today" for
  // canEditDay (Session 6.4). Optional: the magic-link flow that first made it
  // optional is gone (mig 142); left optional pending a check of every producer.
  timezone?: string;
};

// Request/Response types for API

/** One custom question as the client's form receives it. */
export type CheckInFormQuestion = {
  id: string;
  prompt: string;
};

/**
 * The resolved check-in form for one client: which built-in fields to render
 * and which custom questions to ask. `fields` is always resolved — a client
 * with no form row gets all 14 keys, which is why this feature needs no
 * backfill. Field keys and their semantics live in `lib/check-in/form-fields.ts`.
 */
export type CheckInFormConfig = {
  fields: string[];
  questions: CheckInFormQuestion[];
};

/** A question on the COACH's editor, which sees disabled rows too. */
export type CheckInFormEditorQuestion = CheckInFormQuestion & {
  enabled: boolean;
};

/** The coach's editor view of a form — a client's own, or a template's. */
export type CheckInFormEditorConfig = {
  fields: string[];
  questions: CheckInFormEditorQuestion[];
};

/** A saved, reusable form in the coach's library. */
export type CheckInFormTemplate = CheckInFormEditorConfig & {
  id: string;
  name: string;
  createdAt: string;
};

/** A row in the coach's question bank. */
export type CheckInQuestion = {
  id: string;
  prompt: string;
  createdAt: string;
};

/** What the client sends back for one custom question. */
export type CheckInCustomAnswerInput = {
  questionId: string;
  answer: string;
};

/**
 * A stored answer as it is read back. `prompt` is joined LIVE from the
 * question row, never snapshotted — rewording a question relabels every past
 * answer, because it is the same question.
 */
export type CheckInCustomAnswer = CheckInCustomAnswerInput & {
  prompt: string;
};

/**
 * The client portal's check-in context payload (GET /api/client/check-in-context).
 *
 * Was `ValidateCheckInTokenResponse` — it served the magic-link flow, which is
 * deleted. Its `valid` flag went with it: the token that could be invalid no
 * longer exists, and the route already discarded the field.
 *
 * **This type is the RN contract** (`ARCHITECTURE.md → The React Native
 * contract`), so it describes the WHOLE payload. It used to describe five of
 * eleven keys while the route added the rest through a local inline
 * intersection and `use-client-check-in.ts` kept a third private copy of the
 * same shape; a payload key with no type is how the wire and the doc drift
 * apart. Both of those were deleted when `form` was added — one spelling.
 * Additive optional keys are allowed here; removals and renames are not.
 */
export type CheckInContextResponse = {
  clientInfo?: CheckInClientInfo;
  trainingContext?: CheckInTrainingContext;
  nutritionContext?: CheckInNutritionContext;
  dailyLogs?: DailyLog[];
  /** The check-in's reporting window, resolved server-side. */
  periodStart?: string;
  periodEnd?: string;
  periodDays?: number;
  trainingPeriodStats?: { sessionsCompleted: number; sessionsPlanned: number };
  /** Additive (Session 6.2): per-event training detail from `training_events`. */
  trainingEventDetails?: CheckInTrainingEventDetail[];
  /**
   * Additive (C6a): the coach's per-client form. `fields` is resolved and never
   * null. Until a client app reads this it renders the full form and sees no
   * custom questions, which is exactly what every client gets today.
   */
  form?: CheckInFormConfig;
  errorMessage?: string;
};

export type SubmitCheckInResponse = {
  success: boolean;
  checkInId?: string;
  errorMessage?: string;
};

export type GenerateAISummaryResponse = {
  success: boolean;
  summary?: CheckInReview;
  errorMessage?: string;
};

export type ReviewCheckInResponse = {
  success: boolean;
  errorMessage?: string;
};

export type GetCheckInsResponse = {
  checkIns: CheckIn[];
  total: number;
};

/**
 * One page of the coach's per-client check-in list (`GET /api/clients/[id]/check-ins`),
 * which pages on the same opaque `(created_at, id)` cursor as the client's own history.
 *
 * Deliberately NOT an extension of `GetCheckInsResponse`: that shape is shared with
 * `/api/check-ins/unreviewed`, and `total` here is the exact history count taken on the
 * FIRST page only — absent on cursor pages rather than sent as a misleading zero.
 */
export type GetClientCheckInsPageResponse = {
  checkIns: CheckIn[];
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
};

// Chart data for visualizations
// No `label` field: it was built for all eight metrics and read by nothing but
// its own test. The weight one baked a unit into the string inside a pure module
// (lib/check-in-utils.ts), which is unfixable at the render boundary — and did
// not need fixing, because it never reached a screen.
type ChartDataPoint = {
  date: string;
  value: number;
};

export type ProgressChartData = {
  weight: ChartDataPoint[];
  bodyFat: ChartDataPoint[];
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

// API Request/Response types for tracking features

export type GetOverdueClientsResponse = {
  clients: OverdueClient[];
  total: number;
};

export type GetClientsDueSoonResponse = {
  clients: ClientDueSoon[];
  total: number;
};

export type SendReminderResponse = {
  success: boolean;
  reminderId?: string;
  errorMessage?: string;
};

export type UpdateCheckInConfigResponse = {
  success: boolean;
  client?: Client;
  errorMessage?: string;
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
};

/**
 * A nutrition-calculator warning as structured data, never a finished sentence.
 *
 * `services/nutrition-service.ts` is PURE and deliberately runs in two places:
 * on the server via `nutrition-plan-orchestrator.ts`, and in the coach's BROWSER
 * via `hooks/use-nutrition-builder.ts`, which previews a plan before it is
 * saved. It can therefore reach neither `useUnits()` (no React context) nor
 * `getViewerUnitPreference(request)` (server-only).
 *
 * That is why the rate caps used to read "0.75kg/week" for every viewer: the
 * only layer that knows the viewer's unit is the renderer, and a baked sentence
 * put the number out of its reach. These codes carry raw KILOGRAMS;
 * `components/clients/nutrition/nutrition-warnings.tsx` words them.
 */
export type NutritionWarning =
  | { code: "deadline_passed" }
  | { code: "deficit_capped"; maxWeeklyChangeKg: number }
  | { code: "surplus_capped"; maxWeeklyChangeKg: number }
  | { code: "calories_raised_to_minimum"; minimumCalories: number }
  | { code: "protein_below_minimum" }
  | { code: "protein_above_necessary" }
  | { code: "protein_exceeds_calories" }
  | { code: "fat_increased_for_minimum"; gender: "male" | "female" | "other" };

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
  /** The check-in this one is measured against, or null on a first check-in. */
  previous: CheckIn | null;
  client: {
    id: string;
    name: string;
    goalWeight?: number;
    goalBodyFatPercentage?: number;
    goalDeadline?: string;
    currentWeight?: number;
    currentBodyFatPercentage?: number;
    unitPreference?: UnitPreference;
    nutritionPlanBaseWeightKg?: number;
    /** The covering nutrition version's effective_from — when the numbers the
     *  drift banner compares against took effect (migration 144). */
    nutritionPlanEffectiveDate?: string;
  };
  changes: {
    weight?: MetricChange;
    bodyFatPercentage?: MetricChange;
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
    /**
     * Position relative to the goal — `approaching` | `achieved` | `overshot`.
     * Separate from `isOnTrack`, which is the TREND. A renderer showing a
     * magnitude ("5 kg to go") must check this first: `remaining` is signed, and
     * its magnitude means nothing once the goal has been passed.
     */
    status?: GoalStatus;
    remaining: number;
    percentComplete: number;
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
    /** See `weight.status`. */
    status?: GoalStatus;
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

// Check-in with all related details for AI processing
export type CheckInWithDetails = CheckIn & {
  sessionCompletions?: CheckInSessionCompletion[];
  exerciseHighlights?: CheckInExerciseHighlight[];
  /**
   * Answers to the coach's custom questions, joined to their prompts. On
   * `CheckInWithDetails` rather than `CheckIn` deliberately: the client's
   * history LIST renders a date, a status and an AI preview, and embedding a
   * dictionary inside a row list is what CONVENTIONS §8 "Sparse fieldsets"
   * forbids. Because it is not on `CheckIn`, `CLIENT_FACING_CHECKIN_KEYS`
   * cannot leak it by default — the allowlist stays fail-closed.
   */
  customAnswers?: CheckInCustomAnswer[];
};
