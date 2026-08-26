import type { TrainingEventSummary } from "./training";

export type DaySummary = {
  // The day's training events, and nothing else: a workout has one date — the
  // event's — because the client moves the event to the day they train. The
  // "trained for another day" list that used to sit here was retired with the
  // receipt model (2026-08-26).
  training: TrainingEventSummary[];
  nutrition: {
    hasLog: boolean;
    caloriesConsumed: number | null;
    targetCalories: number | null;
    note: string | null; // coach per-day note (event source only)
  } | null; // null = no nutrition target (log or event) for this day
  wellness: { hasLog: boolean };
  habits: { totalCount: number; loggedCount: number };
};
