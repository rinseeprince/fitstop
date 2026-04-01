// Roadmap status
export type RoadmapStatus = "active" | "archived" | "draft";

// Phase status
export type PhaseStatus = "planned" | "active" | "completed" | "skipped";

// Milestone within a phase
export type Milestone = {
  id: string;
  text: string;
  completed: boolean;
  completed_at: string | null;
};

// Body metrics source
export type BodyMetricsSource = "check_in" | "metrics_api" | "intake_sync" | "nutrition_plan";

// Roadmap record (matches database schema)
export type Roadmap = {
  id: string;
  clientId: string;
  coachId: string;
  name: string;
  longTermGoal?: string;
  goalWeight?: number | null;
  goalBodyFatPercentage?: number | null;
  status: RoadmapStatus;
  startedAt?: string;
  targetEndDate?: string;
  createdAt: string;
  updatedAt: string;
};

// Input type for creating/updating roadmaps (excludes server-managed fields)
export type RoadmapInput = Omit<Roadmap, "id" | "createdAt" | "updatedAt">;

// Phase record (matches database schema)
export type Phase = {
  id: string;
  roadmapId: string;
  clientId: string;
  name: string;
  description?: string;
  objectives?: string;
  orderIndex: number;
  status: PhaseStatus;
  startDate?: string;
  endDate?: string;
  durationWeeks?: number;
  phaseGoalsSnapshot?: Record<string, unknown> | null;
  phaseGoalWeight?: number | null;
  phaseGoalBodyFatPercentage?: number | null;
  coachReflection?: string;
  phaseSummary?: Record<string, unknown> | null;
  milestones: Milestone[];
  completionSeen?: boolean;
  createdAt: string;
  updatedAt: string;
};

// Input type for creating/updating phases (excludes server-managed fields)
export type PhaseInput = Omit<Phase, "id" | "createdAt" | "updatedAt">;

// Client goal record (matches database schema)
// Uses superseding pattern: never update, create new and supersede old.
export type ClientGoal = {
  id: string;
  clientId: string;
  goalWeight?: number;
  goalBodyFatPercentage?: number;
  goalDeadline?: string;
  primaryGoal?: string;
  setBy: string;
  notes?: string;
  effectiveFrom: string;
  supersededAt?: string;
  createdAt: string;
  updatedAt: string;
};

// Input type for creating goals (excludes server-managed fields)
export type ClientGoalInput = Omit<
  ClientGoal,
  "id" | "effectiveFrom" | "supersededAt" | "createdAt" | "updatedAt"
>;

// Body metrics event record (matches database schema)
// Immutable event log — no updatedAt.
export type BodyMetricsEvent = {
  id: string;
  clientId: string;
  weight?: number;
  weightUnit?: string;
  bodyFatPercentage?: number;
  bmr?: number;
  tdee?: number;
  source: BodyMetricsSource;
  sourceId?: string;
  recordedAt: string;
  createdAt: string;
};

// Input type for creating body metrics events (excludes server-managed fields)
export type BodyMetricsEventInput = Omit<BodyMetricsEvent, "id" | "createdAt">;

// Database row shapes (until types/database.ts is regenerated)

export type RoadmapRow = {
  id: string;
  client_id: string;
  coach_id: string;
  name: string;
  long_term_goal: string | null;
  goal_weight: number | null;
  goal_body_fat_percentage: number | null;
  status: string;
  started_at: string | null;
  target_end_date: string | null;
  created_at: string;
  updated_at: string;
};

export type PhaseRow = {
  id: string;
  roadmap_id: string;
  client_id: string;
  name: string;
  description: string | null;
  objectives: string | null;
  order_index: number;
  status: string;
  start_date: string | null;
  end_date: string | null;
  duration_weeks: number | null;
  phase_goals_snapshot: Record<string, unknown> | null;
  phase_goal_weight: number | null;
  phase_goal_body_fat_percentage: number | null;
  coach_reflection: string | null;
  phase_summary: Record<string, unknown> | null;
  milestones: Milestone[];
  completion_seen: boolean;
  created_at: string;
  updated_at: string;
};

export type ClientGoalRow = {
  id: string;
  client_id: string;
  goal_weight: number | null;
  goal_body_fat_percentage: number | null;
  goal_deadline: string | null;
  primary_goal: string | null;
  set_by: string;
  notes: string | null;
  effective_from: string;
  superseded_at: string | null;
  created_at: string;
  updated_at: string;
};

export type BodyMetricsEventRow = {
  id: string;
  client_id: string;
  weight: number | null;
  weight_unit: string | null;
  body_fat_percentage: number | null;
  bmr: number | null;
  tdee: number | null;
  source: string;
  source_id: string | null;
  recorded_at: string;
  created_at: string;
};

// Phase review data returned by getPhaseReviewData for the coach transition drawer
export type PhaseReviewData = {
  phase: Phase;
  trainingAdherence: {
    completed: number;
    prescribed: number;
    percentage: number | null;
  } | null;
  nutritionAdherence: {
    averageScore: number;
    logsCount: number;
  } | null;
  habitCompletion: {
    completed: number;
    total: number;
    percentage: number;
  } | null;
  bodyMetrics: {
    start: { weight?: number; bodyFatPercentage?: number } | null;
    current: { weight?: number; bodyFatPercentage?: number } | null;
  };
  goalsAtStart: Record<string, unknown> | null;
  goalsNow: Record<string, unknown> | null;
  phaseGoals: {
    goalWeight: number | null;
    goalBodyFatPercentage: number | null;
  } | null;
  durationDays: number;
  hasNextPhase: boolean;
  nextPhaseName: string | null;
};

// Weekly check-in data row for the phase expanded view table
export type PhaseWeeklyDataRow = {
  weekNumber: number;
  periodStart: string;
  periodEnd: string;
  checkInDate: string;
  weight: number | null;
  nutritionDaysOnTarget: number | null;
  trainingSessions: number;
};
