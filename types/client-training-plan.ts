import type { SetSpec } from "@/utils/exercise-set-specs";

export type ClientTrainingExercise = {
  id: string;
  name: string;
  orderIndex: number;
  sets: number;
  repsMin: number | null;
  repsMax: number | null;
  repsTarget: string | null;
  rpeTarget: number | null;
  tempo: string | null;
  restSeconds: number | null;
  isWarmup: boolean;
  supersetGroup: string | null;
  // Per-set prescription (authoritative when present) + optional demo video,
  // threaded to the client for log-form seeding and display.
  setSpecs: SetSpec[] | null;
  videoUrl: string | null;
};

export type ClientTrainingSessionEntry = {
  id: string;
  name: string;
  focus: string | null;
  orderIndex: number;
  // 0-based week within a multi-week program (absent/0 for single-week plans).
  // Lets the client program view group entries under "Week N" dividers.
  weekIndex?: number;
  isRest: boolean;
  estimatedDurationMinutes: number | null;
  exercises: ClientTrainingExercise[];
};

export type ClientTrainingPlan = {
  planId: string;
  planName: string;
  sessions: ClientTrainingSessionEntry[];
};
