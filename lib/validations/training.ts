import { z } from "zod";
import type { TrainingPlan } from "@/types/training";

export const planStatusSchema = z.enum(["active", "archived", "draft", "planned"]);

export const dayOfWeekSchema = z.enum([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

export const exerciseSchema = z.object({
  name: z.string().min(1, "Exercise name is required").max(200),
  sets: z.number().int().min(1, "At least 1 set required").max(20, "Maximum 20 sets"),
  // reps floor is 0 (timed/AMRAP holds), matching the authoring schemas and the
  // absent reps_min/reps_max DB CHECK — so the single add/edit exercise routes
  // accept a 0-rep exercise too, not just the bulk/clone paths.
  repsMin: z.number().int().min(0).max(100).optional().nullable(),
  repsMax: z.number().int().min(0).max(100).optional().nullable(),
  repsTarget: z.string().max(20).optional().nullable(),
  rpeTarget: z.number().min(1).max(10).optional().nullable(),
  percentage1rm: z.number().min(0).max(100).optional().nullable(),
  tempo: z.string().max(20).optional().nullable(),
  restSeconds: z.number().int().min(0).max(600).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  supersetGroup: z.string().max(10).optional().nullable(),
  isWarmup: z.boolean().optional().default(false),
});

export const sessionSchema = z.object({
  name: z.string().min(1, "Session name is required").max(100),
  dayOfWeek: dayOfWeekSchema.optional().nullable(),
  orderIndex: z.number().int().min(0).optional(),
  focus: z.string().max(200).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  estimatedDurationMinutes: z.number().int().min(10).max(180).optional().nullable(),
  calorieSurplusPercentage: z.number().min(0).max(100).optional().nullable(),
});

export const updateTrainingPlanSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  status: planStatusSchema.optional(),
  frequencyPerWeek: z.number().int().min(1).max(7).optional(),
  programDurationWeeks: z.number().int().min(1).max(52).optional().nullable(),
});

export const updateSessionSchema = sessionSchema.partial();

export const updateExerciseSchema = exerciseSchema.partial();

// =============================================================================
// Coach library (saved-plan / saved-session) mutation schemas
// =============================================================================

// Per-set prescription model (Training Builder S1/S2). Mirrors the SetSpec type
// in utils/exercise-set-specs.ts; stored verbatim in the set_specs JSONB column
// (snake_case keys match the stored shape).
export const setTypeSchema = z.enum([
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
  drops: z
    .array(
      z.object({ weight: z.number().nullable(), reps: z.number().nullable() }),
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

// Reject non-http(s) schemes: z.string().url() accepts javascript:/data: URLs,
// and video_url is rendered as a raw href in the client portal (L3). This is the
// only videoUrl schema, so every write path (create/overwrite/inline/bulk) is
// covered.
export const videoUrlSchema = z
  .string()
  .url()
  .max(500)
  .refine((u) => /^https?:\/\//i.test(u), { message: "Video URL must be http(s)" })
  .nullish();

export const savedExerciseInputSchema = z.object({
  name: z.string().min(1).max(200),
  exerciseId: z.string().uuid().nullish(),
  orderIndex: z.number().int().min(0),
  sets: z.number().int().min(1).max(20),
  repsMin: z.number().int().min(0).max(100).nullish(),
  repsMax: z.number().int().min(0).max(100).nullish(),
  repsTarget: z.string().max(20).nullish(),
  rpeTarget: z.number().min(0).max(10).nullish(),
  percentage1rm: z.number().min(0).max(100).nullish(),
  tempo: z.string().max(20).nullish(),
  restSeconds: z.number().int().min(0).max(600).nullish(),
  notes: z.string().max(500).nullish(),
  supersetGroup: z.string().max(10).nullish(),
  isWarmup: z.boolean().optional(),
  setSpecs: setSpecsArraySchema.nullish(),
  videoUrl: videoUrlSchema,
});

// Per-exercise item for the "replace exercises" (PUT) and "clone-with-overrides"
// paths — the two buttons of the same save-scope dialog, so they MUST validate
// identically. Reuses the bounded exerciseSchema (rpeTarget keeps its min(1) —
// training_exercises has CHECK rpe_target >= 1) but relaxes the reps floor to 0
// to match authoring + the ABSENT reps DB CHECK. Carries setSpecs + (scheme-safe)
// videoUrl so editing one exercise does NOT silently NULL the coach's per-set
// programming — projectExerciseCompact writes whatever it receives, so an
// omitted field became null. Adds orderIndex + exerciseId.
export const bulkExerciseInputSchema = exerciseSchema.extend({
  orderIndex: z.number().int().min(0),
  exerciseId: z.string().uuid().nullish(),
  setSpecs: setSpecsArraySchema.nullish(),
  videoUrl: videoUrlSchema,
});

export const savedSessionInputSchema = z.object({
  name: z.string().min(1).max(100),
  focus: z.string().max(200).nullish(),
  orderIndex: z.number().int().min(0),
  // 0-based slot ordering within a multi-week program (whole program = repeat
  // unit). Defaults to 0 for single-week / legacy plans.
  weekIndex: z.number().int().min(0).max(52).optional(),
  isRest: z.boolean(),
  estimatedDurationMinutes: z.number().int().min(0).max(480).nullish(),
  calorieSurplusPercentage: z.number().min(0).max(100).nullish(),
  notes: z.string().max(1000).nullish(),
  sessionType: z.string().max(50).nullish(),
  exercises: z.array(savedExerciseInputSchema).max(50),
});

export const updateSavedPlanSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullish(),
  // Free-text program focus (see createSavedPlanSchema) — the builder's editable
  // focus can reach this PATCH path too, so accept the same free string as the
  // create/overwrite paths, not the legacy enum.
  splitType: z.string().max(100).nullish(),
  frequencyPerWeek: z.number().int().min(1).max(7).nullish(),
  cycleLength: z.number().int().min(1).max(52).nullish(),
  restPattern: z.array(z.number().int()).max(364).optional(),
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
  // 52 weeks x 7 = 364 slots; 50 exercises/session (the builder ceiling).
  sessions: z.array(z.object({
    tempId: z.string().optional(),
    name: z.string().min(1).max(100),
    dayOfWeek: z.string().optional(),
    focus: z.string().max(200).optional(),
    isRest: z.boolean().optional(),
    exercises: z.array(z.object({
      tempId: z.string().optional(),
      name: z.string().min(1).max(200),
      sets: z.number().int().min(1).max(20),
      repsTarget: z.string().max(20).optional(),
      rpeTarget: z.number().min(0).max(10).optional(),
      restSeconds: z.number().int().min(0).max(600).optional(),
      notes: z.string().max(500).optional(),
    })).max(50),
  })).max(364),
});

// Full-fat standalone-session body, shared by create and overwrite: the
// builder's create-blank slide-over, save-day-as-workout, and the Sessions
// page editor all persist authored sessions here, so the exercise shape must
// match the overwrite input (setSpecs, videoUrl, exerciseId, ...) — a
// narrower schema would silently strip per-set data. orderIndex is optional
// (the service assigns array order); the legacy minimal shape ({name, sets})
// stays valid.
const standaloneSessionBodySchema = z.object({
  name: z.string().min(1).max(100),
  focus: z.string().max(200).nullish(),
  estimatedDurationMinutes: z.number().int().min(0).max(480).nullish(),
  calorieSurplusPercentage: z.number().min(0).max(100).nullish(),
  notes: z.string().max(1000).nullish(),
  exercises: z.array(savedExerciseInputSchema.partial({ orderIndex: true })).max(50),
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
  // Cap the slot count at the builder's own ceiling (52 weeks x 7 days). The
  // placement window is driven by this length; without a bound a crafted body
  // drives an arbitrarily large window/insert loop. .min(1) rejects the empty
  // program that would clear a day and create nothing.
  sessions: z.array(savedSessionInputSchema).min(1).max(364),
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
  // Same cap as the overwrite path: 52 weeks x 7 days. This is the attacker-
  // supplied placement body, so the bound must live here — the placement window
  // is slot-count-driven. .min(1) rejects the rest-only/empty silent wipe.
  sessions: z.array(savedSessionInputSchema).min(1).max(364),
});
export type InlinePlanBody = z.infer<typeof inlinePlanBodySchema>;

export const updateSavedSessionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  focus: z.string().max(200).nullish(),
  isRest: z.boolean().optional(),
  estimatedDurationMinutes: z.number().int().min(0).max(480).nullish(),
  calorieSurplusPercentage: z.number().min(0).max(100).nullish(),
  notes: z.string().max(1000).nullish(),
  sessionType: z.string().max(50).optional(),
});

// =============================================================================
// Event-keyed training log schemas (Session 1.1)
// Quick log = { completionQuality, notes? } — no exercises array.
// Detailed log = same plus an exercises array of per-exercise performance.
// Both shapes hit the same API endpoint; service layer (Session 1.2) decides
// the storage path.
// =============================================================================

export const completionQualitySchema = z.enum(["full", "partial", "skipped"]);

export const setPerformanceSchema = z.object({
  reps: z.number().int().min(1).max(100).optional(),
  weight: z.number().min(0).max(2000).optional(),
  rpe: z.number().min(1).max(10).optional(),
  // Accepted-but-ignored: set_type is coach-prescribed, derived server-side from
  // the prescription snapshot's set_specs at log time (never chosen by the
  // client). Present only so an echo/restore round-trip doesn't fail validation.
  setType: setTypeSchema.optional(),
});

export const exercisePerformanceSchema = z
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

// Event-less log: client trained on a day with no tapped event (rest-day
// training, or picking a session from the rest-day picker). `date` is the day
// trained; `performedSessionId` is required (the picker always supplies one).
// The service runs the matcher to link it to a prescribed event when possible.
export const logSessionForDateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  performedSessionId: z.string().uuid(),
  completionQuality: completionQualitySchema,
  notes: z.string().max(1000).optional(),
  exercises: z.array(exercisePerformanceSchema).max(50).optional(),
});

export type SetPerformanceInput = z.infer<typeof setPerformanceSchema>;
export type ExercisePerformanceInput = z.infer<typeof exercisePerformanceSchema>;
export type LogTrainingEventInput = z.infer<typeof logTrainingEventSchema>;
export type LogSessionForDateInput = z.infer<typeof logSessionForDateSchema>;

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
    exercises: z.array(z.object({
      id: z.string(),
      name: z.string(),
      sets: z.number(),
    }).passthrough()),
  }).passthrough()),
  createdAt: z.string(),
  updatedAt: z.string(),
}).passthrough();

// GET /api/clients/[id]/training response
const getTrainingPlanApiResponseSchema = z.object({
  success: z.boolean(),
  plan: trainingPlanResponseSchema.nullable().optional(),
  upcomingPlan: z.unknown().optional(),
  scheduledFor: z.string().nullable().optional(),
  clientTimezone: z.string().optional(),
  errorMessage: z.string().optional(),
});

// Response types for API calls
export type UpcomingTrainingPlan = {
  id: string;
  effectiveFrom: string;
  name: string;
  splitType: string;
  frequencyPerWeek: number;
  sessions: TrainingPlan["sessions"];
};

export type GetPlanApiResponse = {
  success: boolean;
  plan?: TrainingPlan | null;
  upcomingPlan?: UpcomingTrainingPlan | null;
  /** Set only when there is no active plan and the returned `plan` is a scheduled (planned) one. */
  scheduledFor?: string | null;
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

