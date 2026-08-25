// Daily habit tracking types

// Full daily habit record from database
export type DailyHabit = {
  id: string;
  coachId: string;
  clientId: string;
  name: string;
  description?: string;
  targetValue?: number;
  targetUnit?: string;
  isBoolean: boolean;
  isActive: boolean;
  sortOrder: number;
  effectiveDate: string;
  createdAt: string;
  updatedAt: string;
};

// Input type for coach creating a habit
export type DailyHabitInput = {
  name: string;
  description?: string;
  targetValue?: number;
  targetUnit?: string;
  isBoolean: boolean;
};

// Full daily habit log record from database
export type DailyHabitLog = {
  id: string;
  dailyHabitId: string;
  clientId: string;
  date: string; // ISO date string (YYYY-MM-DD)
  completed: boolean;
  value?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

// Extended habit log with habit details for analytics
export type HabitLogWithDetails = DailyHabitLog & {
  habitName: string;
  targetValue?: number;
  targetUnit?: string;
  isBoolean: boolean;
  habitCreatedAt: string;
  habitEffectiveDate: string;
};