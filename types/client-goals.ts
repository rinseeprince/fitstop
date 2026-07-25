// Client goal record (matches database schema)
// Uses superseding pattern: never update, create new and supersede old.
export type ClientGoal = {
  id: string;
  clientId: string;
  goalWeight?: number;
  goalBodyFatPercentage?: number;
  goalDeadline?: string;
  goalStartDate?: string;
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

// Database row shape (until types/database.ts is regenerated)
export type ClientGoalRow = {
  id: string;
  client_id: string;
  goal_weight: number | null;
  goal_body_fat_percentage: number | null;
  goal_deadline: string | null;
  goal_start_date: string | null;
  primary_goal: string | null;
  set_by: string;
  notes: string | null;
  effective_from: string;
  superseded_at: string | null;
  created_at: string;
  updated_at: string;
};
