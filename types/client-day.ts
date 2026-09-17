import type { TrainingEventSummary } from "./training";

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
  habits: { totalCount: number; loggedCount: number };
};
