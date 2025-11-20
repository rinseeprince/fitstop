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

// Training and nutrition metrics
export type TrainingMetrics = {
  workoutsCompleted?: number;
  adherencePercentage?: number; // 0-100
  prs?: string; // Personal records/wins
  challenges?: string; // Difficulties faced
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

// AI summary data structure
export type AICheckInSummary = {
  summary: string;
  insights: AIInsight[];
  recommendations: AIRecommendation[];
  responseDraft: string;
};

// Complete check-in record (database row)
export type CheckIn = {
  id: string;
  clientId: string;
  clientName?: string; // Populated when joining with clients table
  status: CheckInStatus;

  // Subjective
  mood?: number;
  energy?: number;
  sleep?: number;
  stress?: number;
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

  // Training & nutrition
  workoutsCompleted?: number;
  adherencePercentage?: number;
  prs?: string;
  challenges?: string;

  // AI fields
  aiSummary?: string;
  aiInsights?: AIInsight[];
  aiRecommendations?: AIRecommendation[];
  aiResponseDraft?: string;
  aiProcessedAt?: string;

  // Coach response
  coachResponse?: string;
  coachReviewedAt?: string;
  responseSentAt?: string;

  // Timestamps
  createdAt: string;
  updatedAt: string;
};

// Form data structure for client submission
export type CheckInFormData = SubjectiveMetrics &
  BodyMetrics &
  ProgressPhotos &
  TrainingMetrics;

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

  // Goal fields (manually set by coach)
  goalWeight?: number;
  goalBodyFatPercentage?: number;
  weightUnit?: "lbs" | "kg";

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

  // Nutrition fields
  unitPreference?: UnitPreference;
  workActivityLevel?: ActivityLevel;
  trainingVolumeHours?: TrainingVolume;
  proteinTargetGPerKg?: number; // 1.0-3.0 g/kg
  dietType?: DietType;
  goalDeadline?: string; // ISO date string

  // Nutrition plan metadata
  nutritionPlanCreatedDate?: string; // ISO timestamp
  nutritionPlanBaseWeightKg?: number; // Weight (in kg) when plan was created

  // Locked nutrition targets (from calculation)
  calorieTarget?: number;
  proteinTargetG?: number;
  carbTargetG?: number;
  fatTargetG?: number;

  // Custom macro overrides
  customMacrosEnabled?: boolean;
  customProteinG?: number;
  customCarbG?: number;
  customFatG?: number;
};

// Client info for check-in page
export type CheckInClientInfo = {
  id: string;
  name: string;
  email: string;
  coachName: string;
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
  summary?: AICheckInSummary;
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

// Nutrition plan history record
export type NutritionPlanHistory = {
  id: string;
  clientId: string;
  createdAt: string;

  // Snapshot of client metrics
  baseWeightKg: number;
  goalWeightKg?: number;
  bmr?: number;
  tdee?: number;

  // Settings used
  workActivityLevel: ActivityLevel;
  trainingVolumeHours: TrainingVolume;
  proteinTargetGPerKg: number;
  dietType: DietType;
  goalDeadline?: string;

  // Calculated targets
  calorieTarget: number;
  proteinTargetG: number;
  carbTargetG: number;
  fatTargetG: number;

  // Metadata
  createdByCoachId?: string;
  regenerationReason?: string;
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
  };
  timeBetweenCheckIns?: number; // days
};

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
