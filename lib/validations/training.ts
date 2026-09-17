import { z } from "zod";
import { LOAD_KG_MAX } from "@/lib/constants";
import {
  MAX_PROGRAM_DAYS,
  MAX_PROGRAM_SESSIONS,
  MAX_SESSIONS_PER_DAY,
  MAX_SESSIONS_PER_WEEK,
  MAX_WEEK_LAYOUT_MOVES,
} from "@/lib/training-constants";
import { MAX_PRESCRIBED_ROWS } from "@/utils/set-spec-rows";
import {
  GROUP_FORMATS,
  GROUP_INTERVAL_SECONDS_MAX,
  GROUP_NOTES_MAX,
  GROUP_REST_SECONDS_MAX,
  GROUP_ROUNDS_MAX,
  GROUP_TIME_CAP_SECONDS_MAX,
  MAX_EXERCISES_PER_SESSION,
} from "@/utils/exercise-groups";
import { setSpecCount } from "@/utils/exercise-set-specs";
import { programDays, programRowsIssue } from "@/utils/program-days";
import type { TrainingPlan } from "@/types/training";

export const planStatusSchema = z.enum(["active", "archived", "draft", "planned"]);

export const exerciseSchema = z.object({
  name: z.string().min(1, "Exercise name is required").max(200),
  sets: z.number().int().min(1, "At least 1 set required").max(20, "Maximum 20 sets"),
  // reps floor is 0 (timed/AMRAP holds), matching the authoring schemas and the
  // absent reps_min/reps_max DB CHECK — so the single add/edit exercise routes
  // accept a 0-rep exercise too, not just the bulk paths.
  repsMin: z.number().int().min(0).max(100).optional().nullable(),
  repsMax: z.number().int().min(0).max(100).optional().nullable(),
  repsTarget: z.string().max(20).optional().nullable(),
  rpeTarget: z.number().min(1).max(10).optional().nullable(),
  percentage1rm: z.number().min(0).max(100).optional().nullable(),
  tempo: z.string().max(20).optional().nullable(),
  restSeconds: z.number().int().min(0).max(600).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  isWarmup: z.boolean().optional().default(false),
});

export const updateTrainingPlanSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  status: planStatusSchema.optional(),
  // Sessions per week: a day can hold several, so a week can hold more than seven.
  frequencyPerWeek: z.number().int().min(1).max(MAX_SESSIONS_PER_WEEK).optional(),
  programDurationWeeks: z.number().int().min(1).max(52).optional().nullable(),
});

// =============================================================================
// Coach library (saved-plan / saved-session) mutation schemas
// =============================================================================

// Per-set prescription model (Training Builder S1/S2). Mirrors the SetSpec type
// in utils/exercise-set-specs.ts; stored verbatim in the set_specs JSONB column
// (snake_case keys match the stored shape).
const setTypeSchema = z.enum([
  "warmup",
  "working",
  "amrap",
  "drop",
  "failure",
]);
const loadTypeSchema = z.enum(["absolute", "pct_1rm", "pct_top"]);

export const setSpecSchema = z.object({
  set_number: z.number().int().min(1).max(30),
  set_type: setTypeSchema,
  reps_min: z.number().int().min(0).max(100).nullish(),
  reps_max: z.number().int().min(0).max(100).nullish(),
  reps_target: z.string().max(20).nullish(),
  load_type: loadTypeSchema.nullish(),
  load_value: z.number().min(0).max(2000).nullish(),
  rpe_target: z.number().min(0).max(10).nullish(),
  tempo: z.string().max(20).nullish(),
  rest_seconds: z.number().int().min(0).max(3600).nullish(),
  // A drop carries a VALUE expressed in the PARENT spec's load_type, plus reps.
  // There is deliberately no per-drop load type: every drop of one set shares
  // the set's unit, so "80kg, drop to 60%" is not expressible.
  //
  // `weight` is the pre-load_value spelling (canonical kilograms, from when a
  // drop could only be absolute). Still accepted so historical set_specs
  // validate; nothing writes it any more. Read both through `dropLoadValue`.
  drops: z
    .array(
      z.object({
        load_value: z.number().min(0).max(2000).nullish(),
        weight: z.number().nullish(),
        reps: z.number().nullable(),
      }),
    )
    .max(20)
    .nullish(),
});

// Authoring forbids an all-warmup array — the compact `sets` projection needs at
// least one working set (compactFromSpecs clamps to the training_exercises CHECK
// [1, 20], but an all-warmup array would be a meaningless prescription).
export const setSpecsArraySchema = z
  .array(setSpecSchema)
  .max(30)
  .refine((a) => a.some((s) => s.set_type !== "warmup"), {
    message: "At least one working set is required",
  });

// Which prescription columns the coach uses (migration 149). Absent/null means
// all five — never an empty list: an exercise prescribing nothing renders the
// client an empty grid, which is why the DB CHECK refuses it too.
const prescribedFieldsSchema = z
  .array(z.enum(["set_type", "reps", "load", "rpe", "rest"]))
  .min(1)
  .nullish();

// Reject non-http(s) schemes: z.string().url() accepts javascript:/data: URLs,
// and video_url is rendered as a raw href in the client portal (L3). This is the
// only videoUrl schema, so every write path (create/overwrite/inline/bulk) is
// covered.
const videoUrlSchema = z
  .string()
  .url()
  .max(500)
  .refine((u) => /^https?:\/\//i.test(u), { message: "Video URL must be http(s)" })
  .nullish();

const savedExerciseInputSchema = z.object({
  name: z.string().min(1).max(200),
  exerciseId: z.string().uuid().nullish(),
  sets: z.number().int().min(1).max(20),
  repsMin: z.number().int().min(0).max(100).nullish(),
  repsMax: z.number().int().min(0).max(100).nullish(),
  repsTarget: z.string().max(20).nullish(),
  rpeTarget: z.number().min(0).max(10).nullish(),
  percentage1rm: z.number().min(0).max(100).nullish(),
  tempo: z.string().max(20).nullish(),
  restSeconds: z.number().int().min(0).max(600).nullish(),
  notes: z.string().max(500).nullish(),
  isWarmup: z.boolean().optional(),
  setSpecs: setSpecsArraySchema.nullish(),
  videoUrl: videoUrlSchema,
  prescribedFields: prescribedFieldsSchema,
});

// Per-exercise item for the placed-session tray's save (PUT
// sessions/[sessionId]). Reuses the bounded exerciseSchema (rpeTarget keeps its
// min(1) — training_exercises has CHECK rpe_target >= 1) but relaxes the reps
// floor to 0 to match authoring + the ABSENT reps DB CHECK. Carries setSpecs + (scheme-safe)
// videoUrl so editing one exercise does NOT silently NULL the coach's per-set
// programming — projectExerciseCompact writes whatever it receives, so an
// omitted field became null. Adds exerciseId.
export const bulkExerciseInputSchema = exerciseSchema.extend({
  exerciseId: z.string().uuid().nullish(),
  setSpecs: setSpecsArraySchema.nullish(),
  videoUrl: videoUrlSchema,
  prescribedFields: prescribedFieldsSchema,
});

// A session's groups on every write path (migration 178): each group's settings
// and its exercises, both in order — a position is an element's place in its
// array, never a field. Every exercise sits in a group, so a group holds at
// least one; the session's cap counts exercises across all of its groups.
const groupSettingsInputShape = {
  format: z.enum(GROUP_FORMATS),
  rounds: z.number().int().min(1).max(GROUP_ROUNDS_MAX).nullish(),
  timeCapSeconds: z.number().int().min(1).max(GROUP_TIME_CAP_SECONDS_MAX).nullish(),
  intervalSeconds: z.number().int().min(1).max(GROUP_INTERVAL_SECONDS_MAX).nullish(),
  restBetweenExercisesSeconds: z.number().int().min(0).max(GROUP_REST_SECONDS_MAX).nullish(),
  restBetweenRoundsSeconds: z.number().int().min(0).max(GROUP_REST_SECONDS_MAX).nullish(),
  notes: z.string().max(GROUP_NOTES_MAX).nullish(),
};

// The three rules the builder keeps (program-builder-groups.ts), refused here
// for every other caller: a group of one is a plain exercise with nothing set;
// in a superset or circuit every exercise has one set per round; and a group
// stores no setting its format doesn't use. AMRAP, EMOM and For time are
// commits 14-15's.
type GroupInput = {
  format: string;
  rounds?: number | null;
  timeCapSeconds?: number | null;
  intervalSeconds?: number | null;
  restBetweenExercisesSeconds?: number | null;
  restBetweenRoundsSeconds?: number | null;
  notes?: string | null;
  exercises: Array<{ sets: number; setSpecs?: unknown[] | null }>;
};

function groupRuleIssue(group: GroupInput): string | null {
  const set = (value: unknown) => value != null;
  if (group.exercises.length === 1) {
    const plain =
      group.format === "straight_sets" &&
      !set(group.rounds) &&
      !set(group.timeCapSeconds) &&
      !set(group.intervalSeconds) &&
      !set(group.restBetweenExercisesSeconds) &&
      !set(group.restBetweenRoundsSeconds) &&
      !set(group.notes);
    return plain ? null : "A single exercise can't carry group settings";
  }
  if (group.format === "straight_sets") {
    return set(group.rounds) ||
      set(group.restBetweenRoundsSeconds) ||
      set(group.timeCapSeconds) ||
      set(group.intervalSeconds)
      ? "Straight sets have no rounds"
      : null;
  }
  if (group.format === "circuit") {
    if (set(group.timeCapSeconds) || set(group.intervalSeconds)) {
      return "A superset or circuit has no time cap or interval";
    }
    if (group.rounds == null) return "A superset or circuit needs its rounds";
    const rounds = group.rounds;
    return group.exercises.every((exercise) => setSpecCount(exercise) === rounds)
      ? null
      : "Every exercise in a superset or circuit needs one set per round";
  }
  return null;
}

function exerciseGroupsSchema<
  E extends z.ZodType<{ sets: number; setSpecs?: unknown[] | null }, z.ZodTypeDef, unknown>,
>(exercise: E) {
  return z
    .array(
      z
        .object({
          ...groupSettingsInputShape,
          exercises: z.array(exercise).min(1).max(MAX_EXERCISES_PER_SESSION),
        })
        .superRefine((group, ctx) => {
          const issue = groupRuleIssue(group);
          if (issue) ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue });
        }),
    )
    .max(MAX_EXERCISES_PER_SESSION)
    .refine(
      (groups) =>
        groups.reduce((sum, group) => sum + group.exercises.length, 0) <=
        MAX_EXERCISES_PER_SESSION,
      { message: `A session holds at most ${MAX_EXERCISES_PER_SESSION} exercises` },
    );
}

export const savedExerciseGroupsSchema = exerciseGroupsSchema(savedExerciseInputSchema);
const bulkExerciseGroupsSchema = exerciseGroupsSchema(bulkExerciseInputSchema);
export type SavedExerciseGroupInput = z.infer<typeof savedExerciseGroupsSchema>[number];

// Full replace of a PLACED session (meta + exercises) — the calendar tray's
// save (PUT sessions/[sessionId]). Duration uses the authoring
// bounds (0..480, matching what placement writes from savedSessionInputSchema),
// NOT the retired session PATCH schema's 10..180 — a placed row authored at 8 or 240 minutes
// must round-trip through the tray without a phantom validation error.
export const replaceSessionSchema = z.object({
  name: z.string().min(1).max(100),
  focus: z.string().max(200).nullish(),
  estimatedDurationMinutes: z.number().int().min(0).max(480).nullish(),
  calorieSurplusPercentage: z.number().min(0).max(100).nullish(),
  notes: z.string().max(1000).nullish(),
  groups: bulkExerciseGroupsSchema,
});

export const savedSessionInputSchema = z.object({
  name: z.string().min(1).max(100),
  focus: z.string().max(200).nullish(),
  orderIndex: z.number().int().min(0),
  // 0-based slot ordering within a multi-week program (whole program = repeat
  // unit). Defaults to 0 for single-week / legacy plans.
  weekIndex: z.number().int().min(0).max(52).optional(),
  // The session's place among the sessions on its day (orderIndex), 0 first. A
  // rest row is alone on its day at 0.
  dayOrder: z.number().int().min(0).max(MAX_SESSIONS_PER_DAY - 1).default(0),
  isRest: z.boolean(),
  estimatedDurationMinutes: z.number().int().min(0).max(480).nullish(),
  calorieSurplusPercentage: z.number().min(0).max(100).nullish(),
  notes: z.string().max(1000).nullish(),
  sessionType: z.string().max(50).nullish(),
  groups: savedExerciseGroupsSchema,
});

// A whole program's rows, on the library save and the inline placement: every
// day of every week is its sessions or one rest row (utils/program-days.ts).
// The builder's ceilings bound it — 52 weeks of seven days, each day's sessions
// and the program's — because a program's day count drives the placement
// window and its row count the inserts; without a bound a crafted body drives
// an arbitrarily large window and insert loop. .min(1) rejects the empty
// program that would clear a day and create nothing. Positions must be
// unambiguous: two sessions never share a place on a day, and a rest row is a
// day of its own.
const programSessionsSchema = z
  .array(savedSessionInputSchema)
  .min(1)
  .max(MAX_PROGRAM_DAYS + MAX_PROGRAM_SESSIONS)
  .superRefine((sessions, ctx) => {
    const rows = sessions.map((s) => ({ ...s, weekIndex: s.weekIndex ?? 0 }));
    const issue = programRowsIssue(rows);
    if (issue) ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue });
    if (programDays(rows).length > MAX_PROGRAM_DAYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `A program holds at most ${MAX_PROGRAM_DAYS} days`,
      });
    }
    if (sessions.filter((s) => !s.isRest).length > MAX_PROGRAM_SESSIONS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `A program holds at most ${MAX_PROGRAM_SESSIONS} sessions`,
      });
    }
  });

// One session of a day in the plan editor's save. `eventId` is the calendar
// entry the editor opened it from, when it came from one: the save keeps that
// entry for the session while it stays on the same day.
const planEditSessionInputSchema = z.object({
  eventId: z.string().uuid().nullish(),
  name: z.string().min(1).max(100),
  focus: z.string().max(200).nullish(),
  estimatedDurationMinutes: z.number().int().min(0).max(480).nullish(),
  calorieSurplusPercentage: z.number().min(0).max(100).nullish(),
  notes: z.string().max(1000).nullish(),
  groups: savedExerciseGroupsSchema,
});
export type PlanEditSessionInput = z.infer<typeof planEditSessionInputSchema>;

// Save the plan editor (PUT .../training/[planId]/edit). The body is the WHOLE
// grid — day i is the plan's day effective_from + i, holding its sessions in
// order (none = rest) — and the server decides which of its days are written,
// so a stale editor cannot rewrite a past day. min(7): whole weeks only.
// `version` is the read's, sent back unchanged: the save is refused (409) when
// anything the editor was built from changed.
export const planEditSaveSchema = z.object({
  days: z
    .array(z.object({ sessions: z.array(planEditSessionInputSchema).max(MAX_PROGRAM_SESSIONS) }))
    .min(7)
    .max(MAX_PROGRAM_DAYS)
    .refine(
      (days) => days.reduce((sum, day) => sum + day.sessions.length, 0) <= MAX_PROGRAM_SESSIONS,
      { message: `A plan edit holds at most ${MAX_PROGRAM_SESSIONS} sessions` },
    ),
  plan: z.object({
    name: z.string().min(1).max(100),
    // Free-text program focus (stored in split_type) — same shape as
    // updateSavedPlanSchema/overwriteSavedPlanSchema.
    splitType: z.string().max(100).nullish(),
  }),
  version: z.string().min(1).max(500_000),
});
export type PlanEditSaveBody = z.infer<typeof planEditSaveSchema>;

export const updateSavedPlanSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullish(),
  // Free-text program focus (see createSavedPlanSchema) — the builder's editable
  // focus can reach this PATCH path too, so accept the same free string as the
  // create/overwrite paths, not the legacy enum.
  splitType: z.string().max(100).nullish(),
  frequencyPerWeek: z.number().int().min(1).max(MAX_SESSIONS_PER_WEEK).nullish(),
  defaultSurplusPercentage: z.number().min(0).max(100).nullish(),
  programDurationWeeks: z.number().int().min(1).max(52).nullish(),
});

export const createSavedPlanSchema = z.object({
  name: z.string().min(1).max(100),
  // Focus is free text (a descriptive focus like "Glute hypertrophy"), stored
  // in the free-string split_type column. splitTypeSchema stays the enum only
  // for the AI generation path (aiGeneratedPlanSchema).
  splitType: z.string().max(100).nullish(),
  description: z.string().max(500).nullish(),
  defaultSurplusPercentage: z.number().min(0).max(100).nullish(),
  // Caps mirror the placement paths (H5): a saved plan is the source the
  // type:"plan" placement counts to derive its window, so bound it at creation.
  // A created program's rows are its days, one each: 52 weeks x 7 = 364 days;
  // 50 exercises/session (the builder ceiling).
  sessions: z.array(z.object({
    tempId: z.string().optional(),
    name: z.string().min(1).max(100),
    focus: z.string().max(200).optional(),
    isRest: z.boolean().optional(),
    groups: savedExerciseGroupsSchema,
  })).max(MAX_PROGRAM_DAYS),
});
export type CreateSavedPlanBody = z.infer<typeof createSavedPlanSchema>;

// Full-fat standalone-session body, shared by create and overwrite: the
// builder's create-blank slide-over, save-day-as-workout, and the Sessions
// page editor all persist authored sessions here, so the exercise shape must
// match the overwrite input (setSpecs, videoUrl, exerciseId, ...) — a
// narrower schema would silently strip per-set data.
const standaloneSessionBodySchema = z.object({
  name: z.string().min(1).max(100),
  focus: z.string().max(200).nullish(),
  estimatedDurationMinutes: z.number().int().min(0).max(480).nullish(),
  calorieSurplusPercentage: z.number().min(0).max(100).nullish(),
  notes: z.string().max(1000).nullish(),
  groups: savedExerciseGroupsSchema,
});

// dedupeName: server-side " (copy N)" rename on name conflict (used by the
// builder's save-day-as-workout). Absent/false = current semantics — the
// create slide-over and Sessions-page editor keep the coach's exact name.
export const createStandaloneSessionSchema = standaloneSessionBodySchema.extend({
  dedupeName: z.boolean().optional(),
});

// Full replace of a STANDALONE session (fields + exercises). Same body shape
// as create, no dedupe flag — the coach edited the name deliberately.
export const overwriteStandaloneSessionSchema = standaloneSessionBodySchema;

// Catalog exercise edit — coach-owned rows only (the route/service enforce
// ownership; global rows 404 by construction).
export const updateCatalogExerciseSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  muscleGroup: z.string().max(100).nullish(),
  equipment: z.string().max(100).nullish(),
  category: z.string().max(100).nullish(),
  aliases: z.array(z.string().min(1).max(200)).max(20).optional(),
});

export const overwriteSavedPlanSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullish(),
  // Free-text program focus (stored in split_type, e.g. "Push/Pull") — the
  // builder header edits it. Free text like createSavedPlanSchema, NOT the enum.
  splitType: z.string().max(100).nullish(),
  defaultSurplusPercentage: z.number().min(0).max(100).nullish(),
  sessions: programSessionsSchema,
});

// Inline (edited working copy) placement body — the coach applies their local
// edits to a client's calendar without overwriting the library template. Carries
// splitType + programDurationWeeks as plan metadata (RPC args), but the placement
// WINDOW is the whole-program slot count (one pass), NOT programDurationWeeks.
// frequencyPerWeek is NOT sent — the placement service re-derives it from the
// sessions.
export const inlinePlanBodySchema = z.object({
  name: z.string().min(1).max(100),
  // Free-text program focus (stored in split_type). Free text — training_plans
  // .split_type already accepts it (the pristine place-from-library path copies
  // the template's free-text focus into it).
  splitType: z.string().max(100).nullish(),
  programDurationWeeks: z.number().int().min(1).max(52).nullish(),
  defaultSurplusPercentage: z.number().min(0).max(100).nullish(),
  // The same program rows as the overwrite path. This is the attacker-supplied
  // placement body, so the bounds live here: the placement window is driven by
  // the program's day count.
  sessions: programSessionsSchema,
});
export type InlinePlanBody = z.infer<typeof inlinePlanBodySchema>;

// =============================================================================
// Event-keyed training log schemas (Session 1.1)
// Quick log = { completionQuality, notes? } — no exercises array.
// Detailed log = same plus an exercises array of per-exercise performance.
// Both shapes hit the same API endpoint; service layer (Session 1.2) decides
// the storage path.
// =============================================================================

const completionQualitySchema = z.enum(["full", "partial", "skipped"]);

const setPerformanceSchema = z.object({
  // 1-based index into the FLATTENED prescription (buildPrescribedRows output),
  // never the position in this array and never the spec's own set_number: a drop
  // set's three rows are 3, 4, 5, not three rows all claiming 3. It is the set's
  // identity — the server writes it to set_logs.set_number and reads
  // prescribedRows[setNumber - 1] to stamp the coach-prescribed set_type.
  //
  // There is NO `completed` flag. The client sends exactly the sets it
  // completed; presence in this array IS completion. A set with no reps, weight
  // or RPE is still a set that was done.
  setNumber: z.number().int().min(1).max(MAX_PRESCRIBED_ROWS),
  reps: z.number().int().min(1).max(100).optional(),
  // Canonical kilograms (migration 141). Unlike setSpecSchema.load_value above,
  // this field is never a percentage, so it can carry the named kg bound.
  weight: z.number().min(0).max(LOAD_KG_MAX).optional(),
  rpe: z.number().min(1).max(10).optional(),
  // Accepted-but-ignored: set_type is coach-prescribed, derived server-side from
  // the prescription snapshot's set_specs at log time (never chosen by the
  // client). Present only so an echo/restore round-trip doesn't fail validation.
  setType: setTypeSchema.optional(),
});

const exercisePerformanceSchema = z
  .object({
    trainingExerciseId: z.string().uuid().optional(),
    exerciseId: z.string().uuid().optional(),
    exerciseName: z.string().min(1).max(200),
    sets: z.array(setPerformanceSchema).max(50),
    weightUnit: z.enum(["lbs", "kg"]),
    notes: z.string().max(1000).optional(),
    skipped: z.boolean().optional(),
  })
  .refine(
    (val) => val.skipped === true || val.sets.length > 0,
    { message: "sets must be non-empty unless skipped is true", path: ["sets"] }
  )
  .refine(
    (val) => new Set(val.sets.map((s) => s.setNumber)).size === val.sets.length,
    {
      // set_logs carries UNIQUE (exercise_log_id, set_number) (migration 090),
      // so a duplicate reaches the client as a raw 23505 rendered as a 500.
      // Validation owns this, not the error handler (CONVENTIONS §10).
      message: "setNumber must be unique within an exercise",
      path: ["sets"],
    }
  );

export const logTrainingEventSchema = z.object({
  completionQuality: completionQualitySchema,
  notes: z.string().max(1000).optional(),
  exercises: z.array(exercisePerformanceSchema).max(50).optional(),
  // Session-level swap: the session the client actually performed, when it
  // differs from what was prescribed (planned-day swap or rest-day training).
  // Absent on a normal prescribed log — the writer defaults it to the event's
  // training_session_id. Recorded into session_logs.training_session_id.
  performedSessionId: z.string().uuid().optional(),
});

export type LogTrainingEventInput = z.infer<typeof logTrainingEventSchema>;

// Client week layout (migrations 150, 179): N still-scheduled sessions change
// date in one transaction. A single move is a one-entry layout, a swap two
// entries, a week rearrangement one entry per session it moves; sessions moving
// onto one day join it in the order the list gives them. `fromDate` is the day
// the client SAW the session on — the drift check that turns a concurrent coach
// move into a 409 instead of a half-applied week. Policy (week bound, closed
// weeks) lives in services/training-event-layout-service.ts.
export const clientLayoutSchema = z.object({
  moves: z
    .array(
      z.object({
        eventId: z.string().uuid(),
        fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
        toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
      })
    )
    .min(1)
    .max(MAX_WEEK_LAYOUT_MOVES),
});

// A program's new start date, picked from the Plans hero. Format AND calendar
// validity: "2026-02-31" passes the regex and would reach Postgres as a 500.
// Whether the program may move there is the move function's to say
// (services/training-plan-move-service.ts).
export const moveTrainingPlanSchema = z.object({
  startsOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
    .refine(
      (value) => {
        const parsed = new Date(`${value}T00:00:00Z`);
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
      },
      { message: "Not a real calendar date" }
    ),
});

// =============================================================================
// API Response Validation Schemas
// =============================================================================
// These schemas validate API responses at runtime to catch malformed data.
// They use passthrough() for nested objects to allow additional properties
// and avoid strict type matching issues with ActivityMetadata.

// Base schema for training plan response - validates structure without strict typing
const trainingPlanResponseSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  coachId: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  status: planStatusSchema,
  coachPrompt: z.string(),
  aiResponseRaw: z.string().nullable().optional(),
  // Free-text program focus: builder-authored plans store the coach's typed
  // focus (e.g. "Push Pull Legs (Hypertrophy Focus)") in split_type, so a
  // pristine apply carries free text onto training_plans.split_type. The enum
  // is legacy only; the render layer already falls back to the raw label
  // (SPLIT_TYPE_LABELS[x] || x), so validate as a lenient string, not the enum.
  splitType: z.string().nullish(),
  frequencyPerWeek: z.number(),
  programDurationWeeks: z.number().nullable().optional(),
  sessions: z.array(z.object({
    id: z.string(),
    planId: z.string(),
    name: z.string(),
    groups: z.array(z.object({
      id: z.string(),
      exercises: z.array(z.object({
        id: z.string(),
        name: z.string(),
        sets: z.number(),
      }).passthrough()),
    }).passthrough()),
  }).passthrough()),
  createdAt: z.string(),
  updatedAt: z.string(),
}).passthrough();

// GET /api/clients/[id]/training response
const getTrainingPlanApiResponseSchema = z.object({
  success: z.boolean(),
  plan: trainingPlanResponseSchema.nullable().optional(),
  nextPlan: z
    .object({
      id: z.string(),
      name: z.string(),
      effectiveFrom: z.string(),
      effectiveUntil: z.string(),
    })
    .nullable(),
  clientToday: z.string(),
  planStartFloor: z.string(),
  clientTimezone: z.string().optional(),
  errorMessage: z.string().optional(),
});

// Response types for API calls
type GetPlanApiResponse = {
  success: boolean;
  /** The program covering the client's today, else the first one queued. */
  plan?: TrainingPlan | null;
  /** The program that starts after `plan`, whether `plan` is running or queued. */
  nextPlan: { id: string; name: string; effectiveFrom: string; effectiveUntil: string } | null;
  /** The client's today, on their own calendar. */
  clientToday: string;
  /** The first day a program may start: the deletion floor. A program starting
   *  before it has started, and cannot move. */
  planStartFloor: string;
  clientTimezone?: string;
  errorMessage?: string;
};

// Safe parse helpers - validate structure and cast to correct types
export function parseGetPlanResponse(data: unknown): GetPlanApiResponse | null {
  const result = getTrainingPlanApiResponseSchema.safeParse(data);
  if (!result.success) {
    console.error("Validation error:", result.error.issues);
    return null;
  }
  return result.data as unknown as GetPlanApiResponse;
}

