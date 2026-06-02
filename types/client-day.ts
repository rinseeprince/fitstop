import type { TrainingEventSummary } from "./training";

export type PhaseSummary = {
  id: string;
  name: string;
  weekInPhase: number | null;
  goal: string | null;
  state: "active" | "transitioning";
};

export type DaySummary = {
  phase: PhaseSummary | null;
  training: TrainingEventSummary[];
  // Sessions logged on THIS date whose matched prescribed event falls on a
  // different date (Session 5.4 "Trained for {day}" line). Anchored to the
  // log's completed_at = this date; empty in the normal case. Unmatched extras
  // (training_event_id null) never appear here.
  trainedFor: { date: string; sessionName: string }[];
  nutrition: {
    hasLog: boolean;
    caloriesConsumed: number | null;
    targetCalories: number | null;
  } | null; // null = no nutrition target (log or event) for this day
  wellness: { hasLog: boolean };
  habits: { totalCount: number; loggedCount: number };
};
