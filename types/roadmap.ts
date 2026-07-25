// Roadmap status
export type RoadmapStatus = "active" | "archived" | "draft" | "completed";

// Phase status
export type PhaseStatus = "planned" | "active" | "completed" | "skipped";

// Milestone within a phase
export type Milestone = {
  id: string;
  text: string;
  completed: boolean;
  completed_at: string | null;
};

// Roadmap record (matches database schema)
export type Roadmap = {
  id: string;
  clientId: string;
  coachId: string;
  name: string;
  longTermGoal?: string;
  goalWeight?: number;
  goalBodyFatPercentage?: number;
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
  phaseGoalsSnapshot?: Record<string, unknown>;
  phaseGoalWeight?: number;
  phaseGoalBodyFatPercentage?: number;
  coachReflection?: string;
  phaseSummary?: Record<string, unknown>;
  milestones: Milestone[];
  completionSeen?: boolean;
  createdAt: string;
  updatedAt: string;
};

// Input type for creating/updating phases (excludes server-managed fields)
export type PhaseInput = Omit<Phase, "id" | "createdAt" | "updatedAt">;

// Database row shapes (until types/database.ts is regenerated)

export type RoadmapRow = {
  id: string;
  client_id: string;
  coach_id: string;
  name: string;
  long_term_goal: string | null;
  goal_weight: number | null;
  goal_body_fat_percentage: number | null;
  status: string; // DB returns string; cast to RoadmapStatus in mapper
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
  status: string; // DB returns string; cast to PhaseStatus in mapper
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
