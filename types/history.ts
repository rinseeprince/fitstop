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
};

export type WellnessHistoryRow = {
  date: string;
  mood: number | null;    // 1-5
  energy: number | null;  // 1-10
  sleep: number | null;   // 1-10
  stress: number | null;  // 1-10
};

export type BodyMetricsHistoryRow = {
  created_at: string;
  period_start: string | null;
  period_end: string | null;
  weight: number | null;
  weight_unit: string | null;
  body_fat_percentage: number | null;
  waist: number | null;
  hips: number | null;
  chest: number | null;
  arms: number | null;
  thighs: number | null;
  measurement_unit: string | null;
};

export type HabitMeta = {
  id: string;
  name: string;
  is_boolean: boolean;
  target_value: number | null;
  target_unit: string | null;
  is_active: boolean;
  created_at: string;
  effective_date: string;
};

export type HabitsHistoryRow = {
  date: string;
  habits: Record<string, { completed: boolean; value: number | null; notes: string | null }>;
  total_completed: number;
  total_habits: number;
  [habitId: string]: unknown;
};

export type TrainingHistoryRow = {
  date: string;
  session_name: string;
  is_alternative: boolean;
  completion_quality: "full" | "partial" | "skipped" | null;
  notes: string | null;
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
