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
  // Which prescription columns the coach uses (migration 149). null = all five;
  // the client renders only what is listed, so this is what a coach's column
  // picker actually controls.
  prescribedFields: string[] | null;
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

/**
 * Where the client is in the returned program, resolved server-side against the
 * CLIENT's today:
 * - `active`   — today falls inside the program's window.
 * - `upcoming` — the coach has placed it but it has not started yet.
 * - `ended`    — the whole program has been walked; today is past its last day.
 *
 * Only `active` means "log against this today". The alternative-session picker
 * gates on it, because the write path resolves the plan by date independently
 * and would 404 a session from any other state.
 */
export type ClientTrainingPlanState = "active" | "upcoming" | "ended";

export type ClientTrainingPlan = {
  planId: string;
  planName: string;
  sessions: ClientTrainingSessionEntry[];
  state: ClientTrainingPlanState;
  /** First day of the program, `YYYY-MM-DD`. */
  startsOn: string;
  /** Last day of the program, `YYYY-MM-DD` — the date-walk's final slot. */
  endsOn: string;
};
