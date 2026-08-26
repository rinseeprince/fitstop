export type NutritionHistoryRow = {
  date: string;
  calories_consumed: number | null;
  target_calories: number | null;
  protein_g: number | null;
  target_protein_g: number | null;
  carbs_g: number | null;
  target_carbs_g: number | null;
  fat_g: number | null;
  target_fat_g: number | null;
  calorie_surplus_deficit: number | null;
  nutrition_adherence: "hit" | "partial" | "missed" | null;
  is_logged?: boolean;
};

export type WellnessHistoryRow = {
  date: string;
  mood: number | null;    // 1-5
  energy: number | null;  // 1-10
  sleep: number | null;   // 1-10
  stress: number | null;  // 1-10
  soreness: number | null; // 1-10 (higher = more sore)
  is_logged?: boolean;
};

export type TrainingHistoryRow = {
  date: string;
  session_name: string;
  is_alternative: boolean;
  completion_quality: "full" | "partial" | "skipped" | null;
  notes: string | null;
  is_logged?: boolean;
  session_log_id?: string | null;
};

export type TrainingWeekSummary = {
  completed: number;
  totalPlanned: number;
  plannedUpToToday: number;
  missed: number;
};

// Weekly habits tracker types

export type WeeklyHabitDayStatus = 'completed' | 'missed' | 'pending' | 'future' | 'not-tracked';

export type WeeklyHabitDay = {
  date: string;
  completed: boolean;
  value: number | null;
  status: WeeklyHabitDayStatus;
};

export type WeeklyHabitRow = {
  habitId: string;
  habitName: string;
  isBoolean: boolean;
  targetValue: number | null;
  targetUnit: string | null;
  days: WeeklyHabitDay[];
  weeklyRate: number;
};

export type WeekSummary = {
  todayCompleted: number;
  todayTotal: number;
  weeklyRate: number;
  activeCount: number;
  allHabitsStreak: number;
};

export type WeeklyHabitsResponse = {
  habits: WeeklyHabitRow[];
  summary: WeekSummary;
  weekDays: string[];
};
