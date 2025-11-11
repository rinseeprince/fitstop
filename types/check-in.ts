// Check-in status types
export type CheckInStatus = "pending" | "ai_processed" | "reviewed";

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
