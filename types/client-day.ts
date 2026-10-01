import type { TrainingEventSummary } from "./training";
import type { HabitDaySummary } from "./habits";

export type DaySummary = {
  // The day's training events, and nothing else: a workout has one date — the
  // event's — because the client moves the event to the day they train. The
  // "trained for another day" list that used to sit here was retired with the
  // receipt model (2026-08-26).
  training: TrainingEventSummary[];
  // Always present: a day with no target still takes a log (only the future and
  // a closed week refuse one — lib/daily-log-permissions.ts).
  nutrition: {
    hasLog: boolean;
    caloriesConsumed: number | null;
    targetCalories: number | null; // null = no nutrition plan covers this day
    note: string | null; // the coach's per-day note, on the day's target
  };
  wellness: { hasLog: boolean };
  // `running`: the habits a version covers on the day; `plannedToday`: those
  // planned on it; `doneToday`: how many of those were done that day;
  // `toDoThisWeek`: the habit-days the client week holding the day still asks
  // of the habits running that day.
  habits: HabitDaySummary;
};
