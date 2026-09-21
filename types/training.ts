
import type { SetSpec, SetType } from "@/utils/exercise-set-specs";
import type { PrescribedField } from "@/utils/prescribed-fields";
import type { ExerciseType } from "@/utils/exercise-types";
import type { LoggedActuals } from "@/utils/set-log-measures";
import type { GroupSettings } from "@/utils/exercise-groups";
import type { GroupScoreValue } from "@/utils/group-scores";
import type { RaceDistance } from "@/utils/race-distances";

// Training plan split types
export type TrainingSplitType =
  | "push_pull_legs"
  | "upper_lower"
  | "full_body"
  | "bro_split"
  | "push_pull"
  | "custom";

// Training plan status
export type TrainingPlanStatus = "active" | "archived" | "draft" | "planned";

// Training exercise
export type TrainingExercise = {
  id: string;
  sessionId: string;
  // The group this exercise sits in (migration 178); orderIndex is its
  // position in that group.
  groupId: string;
  exerciseId: string | null;
  name: string;
  orderIndex: number;
  sets: number;
  repsMin?: number;
  repsMax?: number;
  repsTarget?: string;
  rpeTarget?: number;
  percentage1rm?: number;
  tempo?: string;
  restSeconds?: number;
  notes?: string;
  isWarmup: boolean;
  setSpecs?: SetSpec[] | null;
  videoUrl?: string | null;
  // The measurement columns the coach prescribes (migration 183): never empty.
  // REQUIRED, not optional: while it was optional, services/training-mappers.ts
  // simply never mapped the column and every client saw all five columns. A
  // mapper that forgets it is now a compile error.
  prescribedFields: PrescribedField[];
  createdAt: string;
  updatedAt: string;
};

// Exercise catalog entry
export type Exercise = {
  id: string;
  coachId: string | null;
  name: string;
  muscleGroup: string | null;
  equipment: string | null;
  category: string | null;
  // The exercise's type (migration 185): decides the column preset a new
  // exercise starts on. A fact about the catalog row, never copied onto a
  // prescription.
  exerciseType: ExerciseType;
  aliases: string[];
  createdAt: string;
  updatedAt: string;
};

// A client session's group (migration 178): its settings and its exercises in
// order. orderIndex is the group's position in the session.
export type TrainingExerciseGroup = GroupSettings & {
  id: string;
  sessionId: string;
  orderIndex: number;
  exercises: TrainingExercise[];
};

// Training session (workout day) or external activity
export type TrainingSession = {
  id: string;
  planId: string;
  name: string;
  dayOfWeek?: string;
  orderIndex: number;
  focus?: string;
  notes?: string;
  estimatedDurationMinutes?: number;
  // Every exercise sits in a group; the groups are in order.
  groups: TrainingExerciseGroup[];
  // AI-estimated calorie burn (for training sessions)
  estimatedCalories?: number;
  caloriesCalculatedAt?: string;
  // Calorie surplus percentage (overrides plan default when set)
  calorieSurplusPercentage: number | null;
  createdAt: string;
  updatedAt: string;
};

// Training plan
export type TrainingPlan = {
  id: string;
  clientId: string;
  coachId: string;
  name: string;
  description?: string;
  status: TrainingPlanStatus;
  coachPrompt: string;
  aiResponseRaw?: string;
  splitType: TrainingSplitType;
  frequencyPerWeek: number;
  programDurationWeeks?: number;
  // Client metrics snapshot
  clientWeightKg?: number;
  clientBodyFatPercentage?: number;
  clientGoalWeightKg?: number;
  clientTdee?: number;
  // Check-in data snapshot
  avgMood?: number;
  avgEnergy?: number;
  avgSleep?: number;
  avgStress?: number;
  recentAdherencePercentage?: number;
  // Date-effective versioning
  effectiveFrom?: string;
  effectiveUntil?: string;
  sessions: TrainingSession[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

/**
 * Whether the client has LOGGED a calendar workout, and nothing else.
 * `completed` means logged, at any quality — the same word and meaning as the
 * product's "5 of 5 completed". `scheduled` is what every write guard keys on
 * (`assertSessionUnlogged`, the plan editor's save, the move function,
 * placement's window-delete).
 *
 * `missed` is derived and never stored: a workout still scheduled on a day that
 * has passed, judged on the reading surface's own calendar
 * (`lib/training-display-state.ts`).
 */
export type TrainingEventStatus = 'scheduled' | 'completed';

/**
 * How a logged workout went, and the only two words the product writes or
 * shows — `session_logs.completion_quality` (migration 182).
 *
 * `full` is every prescribed working set on every exercise; `partial` is
 * anything short of that. Server-derived at save
 * (`utils/completion-quality.ts`). It never says whether the workout was
 * logged — `TrainingEventStatus` does.
 */
export type LoggedQuality = 'full' | 'partial';

/**
 * The workout's log, as much of it as a calendar read needs: read through the
 * NAMED foreign key on every event read (`training_events_session_log_id_fkey`
 * — two relationships exist between the tables, so an unnamed embed is a
 * PGRST201). `null` when the client has not logged the workout.
 *
 * `completionQuality` is where a screen reads how the workout went; the event's
 * `status` says only whether it was logged (`lib/training-display-state.ts`).
 */
export type TrainingEventLog = {
  id: string;
  /**
   * How the workout went. A log row written before the column had a value
   * reads `full` — a workout done at a quality nobody recorded is a full one.
   */
  completionQuality: LoggedQuality;
  /** The session the client PERFORMED — different from the event's when they swapped. */
  performedSessionId: string | null;
  notes: string | null;
};

// Concrete calendar event for a training session on a specific date
export type TrainingEvent = {
  id: string;
  clientId: string;
  // Nullable since mig 113: the event->plan FK is ON DELETE SET NULL, so a plan
  // hard-delete (events-as-SOT overhaul, Sessions 2-3) can orphan the event.
  trainingPlanId: string | null;
  trainingSessionId: string | null;
  date: string;
  sessionName: string;
  sessionFocus: string | null;
  estimatedCalories: number | null;
  /** Whether the client has logged this workout — never how it went (`log` says that). */
  status: TrainingEventStatus;
  sessionLogId: string | null;
  /** The workout's log, embedded on every event read. Null when it isn't logged. */
  log: TrainingEventLog | null;
  isModified: boolean;
  calorieSurplusPercentage: number | null;
  createdAt: string;
  updatedAt: string;
};

// Lightweight summary for day-summary endpoint (home screen card)
export type TrainingEventSummary = {
  eventId: string;
  // The session the client actually performed (the prescribed one unless they
  // swapped). isAlternative is true when it differs from the prescribed session.
  sessionName: string;
  sessionFocus: string | null;
  /** How the workout went, off its log (`loggedDisplayQuality`); null when unlogged. */
  completionQuality: "full" | "partial" | null;
  isAlternative: boolean;
  loggedExerciseCount: number;
  prescribedExerciseCount: number;
};

export type UpdateTrainingPlanRequest = {
  name?: string;
  description?: string | null;
  status?: TrainingPlanStatus;
  frequencyPerWeek?: number;
  programDurationWeeks?: number | null;
};

// --- Coach Library Types ---

export type SavedPlanStatus = 'draft' | 'saved';
export type SavedPlanSource = 'ai' | 'manual';
export type SavedSessionType = 'training';

export type SavedPlan = {
  id: string;
  coachId: string;
  name: string;
  description: string | null;
  splitType: TrainingSplitType | null;
  frequencyPerWeek: number | null;
  status: SavedPlanStatus;
  defaultSurplusPercentage: number | null;
  source: SavedPlanSource;
  coachPrompt: string | null;
  programDurationWeeks: number | null;
  sessions: SavedSession[];
  createdAt: string;
  updatedAt: string;
};

// Lean list-row for the paginated Programs library — plan scalars + counts
// derived server-side from the session rows (is_rest embed) and
// program_duration_weeks, with NO nested sessions or exercises (the list never
// renders them). See getSavedPlansPage. splitType is free text here (a
// descriptive focus), stored in the free-string column.
export type SavedPlanListItem = {
  id: string;
  name: string;
  description: string | null;
  splitType: string | null;
  source: SavedPlanSource;
  status: SavedPlanStatus;
  frequencyPerWeek: number | null;
  weekCount: number;
  // Days of the program; a day can hold several sessions.
  totalSlots: number;
  // Rest days.
  restCount: number;
  // Sessions, across every day.
  trainingCount: number;
  createdAt: string;
  updatedAt: string;
};

// Aggregate stats over ALL of a coach's plans, for the Programs stat band —
// decoupled from list pagination (see getSavedPlansSummary).
export type SavedPlansSummary = {
  total: number;
  aiCount: number;
  customCount: number;
  avgWeeks: number | null;
  minWeeks: number;
  maxWeeks: number;
};

export type SavedSession = {
  id: string;
  coachId: string;
  savedPlanId: string | null;
  name: string;
  focus: string | null;
  orderIndex: number;
  // Internal slot ordering within a multi-week program (0-based). The whole
  // program is the repeat unit at apply time; weekIndex carries no calendar-week
  // meaning. Defaults to 0 (single-week / legacy plans).
  weekIndex: number;
  // The session's place among the sessions on its day (weekIndex, orderIndex),
  // 0 first (migration 180). 0 for a standalone session and a rest row.
  dayOrder: number;
  isRest: boolean;
  estimatedDurationMinutes: number | null;
  calorieSurplusPercentage: number | null;
  notes: string | null;
  sessionType: SavedSessionType;
  // Every exercise sits in a group; the groups are in order (migration 178).
  groups: SavedExerciseGroup[];
  createdAt: string;
  updatedAt: string;
};

// A library session's group: its settings and its exercises in order.
// orderIndex is the group's position in the session.
export type SavedExerciseGroup = GroupSettings & {
  id: string;
  savedSessionId: string;
  orderIndex: number;
  exercises: SavedExercise[];
};

export type SavedExercise = {
  id: string;
  savedSessionId: string;
  // The group this exercise sits in; orderIndex is its position in it.
  groupId: string;
  exerciseId: string | null;
  name: string;
  orderIndex: number;
  sets: number;
  repsMin: number | null;
  repsMax: number | null;
  repsTarget: string | null;
  rpeTarget: number | null;
  percentage1rm: number | null;
  tempo: string | null;
  restSeconds: number | null;
  isWarmup: boolean;
  notes: string | null;
  setSpecs: SetSpec[] | null;
  videoUrl: string | null;
  // The measurement columns the coach prescribes (migration 183): never empty.
  prescribedFields: PrescribedField[];
  createdAt: string;
  updatedAt: string;
};

// =============================================================================
// Event-keyed training log types (Session 1.1)
// Stable contracts for Session 1.2 (service impl) and 1.3 (API routes).
// =============================================================================

export type LogTrainingEventResponse = {
  sessionLogId: string;
};

// Camel-case mirror of the session_logs row.
export type SessionLog = {
  id: string;
  clientId: string;
  trainingSessionId: string | null;
  // The prescribed training_event this log is keyed to (Session 5.2 event-keyed
  // identity). null for legacy logs never linked to an event, or truly-extra
  // rest-day training that found no matching prescribed event.
  trainingEventId: string | null;
  completedAt: string;
  /** How the workout went; a row that recorded none reads `full`. */
  completionQuality: LoggedQuality;
  notes: string | null;
  weekStartDate: string;
  prescribedSessionSnapshot: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

// Camel-case mirror of a set_logs row: its identity, then every actual the
// set can carry (utils/set-log-measures.ts, migration 184), null where nothing
// was recorded.
export type SetLog = {
  id: string;
  exerciseLogId: string;
  setNumber: number;
  // Coach-prescribed set type, seeded from the prescription's set_specs at log
  // time (set_logs.set_type). Defaults to 'working'.
  setType: SetType;
} & LoggedActuals & {
  createdAt: string;
  updatedAt: string;
};

// A timed group's score on a workout's log (migration 186): rounds and reps,
// or a finish time (`GroupScoreValue` — the shape says whether a For time was
// capped). `groupId` is the client group scored, null once that group row is
// gone; `prescribedGroupSnapshot` is the group's settings as logged, the same
// nine snake_case keys an exercise snapshot's `group` carries, so a scored
// group describes itself without its exercises.
export type GroupScore = GroupScoreValue & {
  id: string;
  sessionLogId: string;
  groupId: string | null;
  prescribedGroupSnapshot: Record<string, unknown>;
};

// Camel-case mirror of the exercise_logs row, plus a service-attached `sets`
// array of child set_logs (populated by the reader, not present on the row).
//
// Display-name resolution rule:
//   performedName ?? prescribedExerciseSnapshot?.name ?? "Unknown exercise"
export type ExerciseLog = {
  id: string;
  sessionLogId: string;
  trainingExerciseId: string | null;
  exerciseId: string | null;
  completed: boolean;
  notes: string | null;
  performedName: string | null;
  prescribedExerciseSnapshot: Record<string, unknown> | null;
  sets: SetLog[];
  createdAt: string;
  updatedAt: string;
};

// One exercise of the PERFORMED session's live prescription, returned alongside
// a session log so the coach's readout can show an exercise the client never
// touched. Such an exercise is absent from exercise_logs entirely (the log
// payload omits it), so without this the coach had no way to see it was asked
// for. `snapshot` is the same snake_case shape ExerciseLog.prescribedExerciseSnapshot
// carries, so both go through one expansion.
export type SessionLogPrescribedExercise = {
  trainingExerciseId: string;
  name: string;
  // Carries the exercise's group and its place in it (migration 178).
  snapshot: Record<string, unknown>;
};

// A group of the performed session's live prescription: its settings and its
// exercises in order. orderIndex is the group's place in the session.
export type SessionLogPrescribedGroup = GroupSettings & {
  id: string;
  orderIndex: number;
  exercises: SessionLogPrescribedExercise[];
};

// The coach's logged-workout detail payload (GET
// /api/clients/[id]/training/session-logs/[sessionLogId]).
export type SessionLogDetail = {
  sessionLog: SessionLog;
  exerciseLogs: ExerciseLog[];
  /** The timed groups' scores, one per scored group. */
  groupScores: GroupScore[];
  /** Live name of the session PERFORMED; null if it was hard-deleted. */
  performedSessionName: string | null;
  /**
   * The performed session's active exercises, group by group in authored order.
   * Empty when the log has no training_session_id (legacy, or the session was
   * deleted), and the readout then falls back to the logs alone.
   */
  prescribedGroups: SessionLogPrescribedGroup[];
};

// A session as a workout's header: everything but its groups, which the workout
// read returns resolved beside it (TrainingEventDetail.groups).
export type TrainingSessionHeader = Omit<TrainingSession, "groups">;

// Resolved session/exercise carries a discriminator so consumers know whether
// the row came from a live FK reference or the snapshot fallback. After plan
// edits or session deletions, the live ref may be null while the snapshot
// preserves the prescription as it was at log time.
export type ResolvedSession =
  | { source: 'live'; session: TrainingSessionHeader }
  | { source: 'snapshot'; snapshot: Record<string, unknown> };

// A snapshot exercise names the exercise it was logged against
// (`exercise_logs.training_exercise_id`): the snapshot itself carries no id,
// and the client's log form pairs the exercise with its logged sets by it.
export type ResolvedExercise =
  | { source: 'live'; exercise: TrainingExercise }
  | { source: 'snapshot'; trainingExerciseId: string; snapshot: Record<string, unknown> };

// A workout's group as the client's workout read returns it: its settings and
// its exercises in order, each live or read off the log's snapshot.
export type ResolvedExerciseGroup = GroupSettings & {
  id: string;
  orderIndex: number;
  exercises: ResolvedExercise[];
};

// Combined event detail returned by getTrainingEventDetail(): the workout as
// ordered groups, the one place its prescription is on the payload.
// exerciseLogs is empty when the client used quick log only or hasn't logged yet.
export type TrainingEventDetail = {
  event: TrainingEvent;
  session: ResolvedSession;
  groups: ResolvedExerciseGroup[];
  sessionLog: SessionLog | null;
  exerciseLogs: ExerciseLog[];
  /** The timed groups' scores on the log; empty when unlogged or none scored. */
  groupScores: GroupScore[];
};

// =============================================================================
// Exercise analytics types
// Used by exercise-analytics-service and the two exercise-history routes. A
// progression point is one logged session: its working sets, every chart
// marker it can have (utils/exercise-progress-markers.ts names them) and the
// figures of its Sessions table row (utils/exercise-session-figures.ts), all
// computed by one kernel (utils/exercise-session-markers.ts), so a chart and a
// table of any exercise type read one shape.
// =============================================================================

export type ExerciseListItem = {
  exerciseId: string | null;
  name: string;
  logCount: number;
  lastLoggedDate: string;
  /** The catalog row's type, Strength for a freehand name: it says which markers lead the chart. */
  exerciseType: ExerciseType;
};

/** A working set as a session's shorthand reads it, canonical: kilograms, metres, seconds. */
export type ExerciseSessionSet = {
  weight: number | null;
  reps: number | null;
  distanceMeters: number | null;
  durationSeconds: number | null;
};

export type ExerciseProgressionPoint = {
  date: string;
  sessionLogId: string;
  /** The calendar workout the session was logged for; null on a log that has none. */
  eventId: string | null;
  /** The session's working sets, in the order they were logged. */
  sets: ExerciseSessionSet[];
  // A lift: the heaviest working set, and what else that set recorded
  topSetWeight: number | null;
  topSetReps: number | null;
  topSetDistanceMeters: number | null;
  topSetDurationSeconds: number | null;
  // The top set's RPE — in a session with no loaded set, the highest RPE
  // logged. The RPE chart lens and the Sessions table read one value.
  rpe: number | null;
  estimatedOneRepMax: number | null;
  totalVolume: number | null;
  // Reps: the most in one set logged with no load, and all of them added up
  bestSetReps: number | null;
  totalReps: number | null;
  // The session as a whole: its distance and time added up, the average pace
  // and split over them, the average stroke rate and watts, the highest zone
  totalDistanceMeters: number | null;
  totalDurationSeconds: number | null;
  averagePaceSecondsPerKm: number | null;
  averageSplitSecondsPer500m: number | null;
  averageStrokeRate: number | null;
  averagePower: number | null;
  maxHeartRateZone: number | null;
  // A hold: the longest set that logged a time and no distance
  longestHoldSeconds: number | null;
  // Compliance: the prescription the session was logged against
  prescribedSets: number | null;
  actualSets: number;
  prescribedRepsMin: number | null;
  prescribedRepsMax: number | null;
};

/**
 * An exercise's bests, one shape per kind (utils/exercise-progress-markers.ts
 * BEST_KINDS): the heaviest weight per rep count, the most reps in a set logged
 * with no load, the fastest time at each distance, the heaviest load per
 * distance, the longest set logged with no distance. An Endurance or Erg
 * exercise's best times are at race distances (utils/race-distances.ts):
 * `race` names it and `distanceMeters` is the race's own length; every other
 * type's are at the distance logged, with no race.
 */
export type ExerciseBest =
  | { kind: "rep_max"; reps: number; weight: number }
  | { kind: "best_reps"; reps: number }
  | { kind: "best_time"; distanceMeters: number; durationSeconds: number; race: RaceDistance | null }
  | { kind: "heaviest_carry"; distanceMeters: number; weight: number }
  | { kind: "longest_hold"; durationSeconds: number };

export type ExercisePR = ExerciseBest & {
  date: string;
  /** The logged session that set it: the one its Sessions table row stars. */
  sessionLogId: string;
  /** Set within the last 28 days. */
  isRecent: boolean;
};

/**
 * One exercise the client has logged with its bests — a row of the All
 * exercises table (get_client_exercise_bests, migration 191). The bests are its
 * records summarised, so a row and the exercise's PR cards never disagree:
 * the heaviest of its rep maxes, the best estimated 1RM they give, its best
 * bodyweight set, its record at the longest race distance it holds one at,
 * its heaviest carry with the distance, its longest hold — null where it has
 * none. Canonical units: kilograms, metres, seconds.
 */
export type ExerciseBestsRow = {
  exerciseId: string | null;
  name: string;
  exerciseType: ExerciseType;
  /** The sessions it was logged in. */
  sessionCount: number;
  /** The latest of them — a day stamp, like a progression point's date. */
  lastLoggedDate: string;
  heaviestLoad: number | null;
  bestEstimatedOneRepMax: number | null;
  bestSetReps: number | null;
  bestTime: { race: RaceDistance; durationSeconds: number } | null;
  heaviestCarry: { weight: number; distanceMeters: number } | null;
  longestHoldSeconds: number | null;
};
