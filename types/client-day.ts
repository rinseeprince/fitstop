import type { TrainingEventSummary } from "./training";

export type DaySummary = {
  training: TrainingEventSummary[];
  nutrition: { hasLog: boolean } | null; // null = no nutrition event for this day
  wellness: { hasLog: boolean };
  habits: { totalCount: number; loggedCount: number };
};
