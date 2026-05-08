import { z } from "zod";
import type { TrainingPlan } from "@/types/training";

export const splitTypeSchema = z.enum([
  "push_pull_legs",
  "upper_lower",
  "full_body",
  "bro_split",
  "push_pull",
  "custom",
]);

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
  repsMin: z.number().int().min(1).max(100).optional().nullable(),
  repsMax: z.number().int().min(1).max(100).optional().nullable(),
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

export const generateTrainingPlanSchema = z.object({
  coachPrompt: z
    .string()
    .min(10, "Please provide more detail in your prompt (at least 10 characters)")
    .max(2000, "Prompt is too long (maximum 2000 characters)"),
  name: z.string().trim().min(1).max(80).optional(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format").optional(),
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

// Schema for bulk reordering sessions
export const reorderSessionSchema = z.object({
  sessionId: z.string().uuid(),
  dayOfWeek: dayOfWeekSchema.optional().nullable(),
  orderIndex: z.number().int().min(0),
});

export const reorderSessionsSchema = z.array(reorderSessionSchema);

// =============================================================================
// Coach library (saved-plan / saved-session) mutation schemas
// =============================================================================

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
});

export const savedSessionInputSchema = z.object({
  name: z.string().min(1).max(100),
  focus: z.string().max(200).nullish(),
  orderIndex: z.number().int().min(0),
  isRest: z.boolean(),
  estimatedDurationMinutes: z.number().int().min(0).max(480).nullish(),
  calorieSurplusPercentage: z.number().min(0).max(100).nullish(),
  notes: z.string().max(1000).nullish(),
  sessionType: z.string().max(50).nullish(),
  exercises: z.array(savedExerciseInputSchema),
});

export const updateSavedPlanSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullish(),
  splitType: splitTypeSchema.nullish(),
  frequencyPerWeek: z.number().int().min(1).max(7).nullish(),
  cycleLength: z.number().int().min(1).max(52).nullish(),
  restPattern: z.array(z.number().int()).optional(),
  defaultSurplusPercentage: z.number().min(0).max(100).nullish(),
  programDurationWeeks: z.number().int().min(1).max(52).nullish(),
});

export const createSavedPlanSchema = z.object({
  name: z.string().min(1).max(100),
  splitType: splitTypeSchema,
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
    })),
  })),
});

export const createStandaloneSessionSchema = z.object({
  name: z.string().min(1).max(100),
  focus: z.string().max(200).optional(),
  exercises: z.array(z.object({
    name: z.string().min(1).max(200),
    sets: z.number().int().min(1).max(20),
    repsTarget: z.string().max(20).optional(),
    rpeTarget: z.number().min(0).max(10).optional(),
    restSeconds: z.number().int().min(0).max(600).optional(),
    notes: z.string().max(500).optional(),
  })),
});

export const overwriteSavedPlanSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullish(),
  defaultSurplusPercentage: z.number().min(0).max(100).nullish(),
  sessions: z.array(savedSessionInputSchema),
});

export const updateSavedSessionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  focus: z.string().max(200).nullish(),
  isRest: z.boolean().optional(),
  estimatedDurationMinutes: z.number().int().min(0).max(480).nullish(),
  calorieSurplusPercentage: z.number().min(0).max(100).nullish(),
  notes: z.string().max(1000).nullish(),
  sessionType: z.string().max(50).optional(),
});

export const updateSavedExerciseSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  sets: z.number().int().min(1).max(20).optional(),
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
});

export const reorderSavedSessionsSchema = z.object({
  order: z.array(z.object({
    sessionId: z.string().uuid(),
    orderIndex: z.number().int().min(0),
  })).min(1),
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
});

export const exercisePerformanceSchema = z
  .object({
    trainingExerciseId: z.string().uuid().optional(),
    exerciseId: z.string().uuid().optional(),
    exerciseName: z.string().min(1).max(200),
    sets: z.array(setPerformanceSchema),
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
  exercises: z.array(exercisePerformanceSchema).optional(),
});

export type SetPerformanceInput = z.infer<typeof setPerformanceSchema>;
export type ExercisePerformanceInput = z.infer<typeof exercisePerformanceSchema>;
export type LogTrainingEventInput = z.infer<typeof logTrainingEventSchema>;

// Validation function to ensure client has basic data for training plan
export function validateClientForTraining(client: {
  currentWeight?: number;
  goalWeight?: number;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!client.currentWeight) {
    errors.push("Client must have a current weight recorded");
  }

  // Goal weight is helpful but not strictly required
  if (!client.goalWeight) {
    errors.push("Client should have a goal weight set for better recommendations");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

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
  splitType: splitTypeSchema,
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
  errorMessage: z.string().optional(),
});

// POST /api/clients/[id]/training response (generate) - returns savedPlanId (library draft)
const generateTrainingPlanApiResponseSchema = z.object({
  success: z.boolean(),
  savedPlanId: z.string().optional(),
  error: z.string().optional(),
  errorMessage: z.string().optional(),
});

// POST /api/clients/[id]/training/manual response - returns savedPlanId (library draft)
const saveManualPlanApiResponseSchema = z.object({
  success: z.boolean(),
  savedPlanId: z.string().optional(),
  error: z.string().optional(),
});

// POST /api/clients/[id]/training/suggestions response
const suggestionsApiResponseSchema = z.object({
  success: z.boolean(),
  suggestions: z.array(z.string()).optional(),
  error: z.string().optional(),
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
  errorMessage?: string;
};

export type GeneratePlanApiResponse = {
  success: boolean;
  savedPlanId?: string;
  error?: string;
  errorMessage?: string;
};

export type SaveManualPlanApiResponse = {
  success: boolean;
  savedPlanId?: string;
  error?: string;
};

export type SuggestionsApiResponse = {
  success: boolean;
  suggestions?: string[];
  error?: string;
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

export function parseGeneratePlanResponse(data: unknown): GeneratePlanApiResponse | null {
  const result = generateTrainingPlanApiResponseSchema.safeParse(data);
  if (!result.success) {
    console.error("Validation error:", result.error.issues);
    return null;
  }
  return result.data as unknown as GeneratePlanApiResponse;
}

export function parseSaveManualResponse(data: unknown): SaveManualPlanApiResponse | null {
  const result = saveManualPlanApiResponseSchema.safeParse(data);
  if (!result.success) {
    console.error("Validation error:", result.error.issues);
    return null;
  }
  return result.data as unknown as SaveManualPlanApiResponse;
}

export function parseSuggestionsResponse(data: unknown): SuggestionsApiResponse | null {
  const result = suggestionsApiResponseSchema.safeParse(data);
  if (!result.success) {
    console.error("Validation error:", result.error.issues);
    return null;
  }
  return result.data;
}

