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
  nutrition: { hasLog: boolean } | null; // null = no nutrition event for this day
  wellness: { hasLog: boolean };
  habits: { totalCount: number; loggedCount: number };
};
