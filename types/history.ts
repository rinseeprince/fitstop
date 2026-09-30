import type { TrainingDayStatus } from "@/types/schedule";

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
  /**
   * Attendance: whether the client logged the workout, and for one they did
   * not, whether its day has passed. `rest` is a day holding no workout. The
   * schedule shape's own word (`ScheduleDay.status`), so the table cannot
   * spell it a second way.
   */
  status: TrainingDayStatus;
  /** How the workout went, off its log (`loggedDisplayQuality`); null when unlogged. */
  completion_quality: "full" | "partial" | null;
  notes: string | null;
  session_log_id?: string | null;
};

export type TrainingWeekSummary = {
  completed: number;
  totalPlanned: number;
  plannedUpToToday: number;
  missed: number;
};
