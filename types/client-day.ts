import type { TrainingEventSummary } from "./training";

export type DaySummary = {
  training: TrainingEventSummary[];
  // Sessions logged on THIS date whose matched prescribed event falls on a
  // different date (Session 5.4 "Trained for {day}" line). Anchored to the
  // log's completed_at = this date; empty in the normal case. Unmatched extras
  // (training_event_id null) never appear here.
  // A session logged ON this day that the matcher attributed to a prescribed
  // event on another day. `eventId` opens that log from here (pre-filled;
  // editable under THIS day's rules, read-only on the prescribed day).
  trainedFor: { date: string; sessionName: string; eventId: string }[];
  nutrition: {
    hasLog: boolean;
    caloriesConsumed: number | null;
    targetCalories: number | null;
    note: string | null; // coach per-day note (event source only)
  } | null; // null = no nutrition target (log or event) for this day
  wellness: { hasLog: boolean };
  habits: { totalCount: number; loggedCount: number };
};
