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
};

export type ClientTrainingSessionEntry = {
  id: string;
  name: string;
  focus: string | null;
  orderIndex: number;
  isRest: boolean;
  estimatedDurationMinutes: number | null;
  exercises: ClientTrainingExercise[];
};

export type ClientTrainingPlan = {
  planId: string;
  planName: string;
  cycleLength: number;
  restPattern: number[];
  sessions: ClientTrainingSessionEntry[];
};
