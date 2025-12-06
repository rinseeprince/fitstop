import { z } from "zod";

const VALID_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

const dayOfWeekSchema = z.enum(VALID_DAYS);

// Helper to handle dayOfWeek with preprocessing for optional fields
const optionalDayOfWeek = z.preprocess(
  (val) => {
    if (val === null || val === undefined || val === "") return undefined;
    if (typeof val === "string" && VALID_DAYS.includes(val as typeof VALID_DAYS[number])) {
      return val;
    }
    return undefined;
  },
  dayOfWeekSchema.optional()
);

// Helper to handle null/undefined/empty string as undefined
const optionalString = (maxLength: number) =>
  z.preprocess(
    (val) => (val === null || val === "" ? undefined : val),
    z.string().max(maxLength).optional()
  );

// Helper to handle null/undefined as undefined for optional numbers
const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess(
    (val) => {
      if (val === null || val === undefined || val === "") return undefined;
      const num = typeof val === "string" ? parseFloat(val) : val;
      return typeof num === "number" && !isNaN(num) ? num : undefined;
    },
    schema.optional()
  );

// Helper to handle null/undefined as undefined for optional integers
const optionalInt = (schema: z.ZodNumber) =>
  z.preprocess(
    (val) => {
      if (val === null || val === undefined || val === "") return undefined;
      const num = typeof val === "string" ? parseInt(val, 10) : val;
      return typeof num === "number" && !isNaN(num) ? num : undefined;
    },
    schema.optional()
  );

// Session completion schema
export const sessionCompletionSchema = z.object({
  trainingSessionId: z.string().uuid(),
  sessionName: z.string().min(1).max(100),
  dayOfWeek: optionalDayOfWeek,
  completed: z.preprocess((val) => val === true || val === "true", z.boolean()),
  completionQuality: z.enum(["full", "partial", "skipped"]).optional().nullable().transform((v) => v ?? undefined),
  notes: optionalString(500),
});

// Exercise highlight schema
export const exerciseHighlightSchema = z.object({
  exerciseId: z.string().uuid().optional().nullable().transform((v) => v ?? undefined),
  exerciseName: z.string().min(1).max(100),
  highlightType: z.enum(["pr", "struggle", "note"]),
  details: optionalString(500),
  weightValue: optionalNumber(z.number().positive().max(2000)),
  weightUnit: z.enum(["lbs", "kg"]).optional().nullable().transform((v) => v ?? undefined),
  reps: optionalInt(z.number().int().min(1).max(1000)),
});

// External activity schema
export const externalActivitySchema = z.object({
  activityName: z.string().min(1).max(100),
  intensityLevel: z.enum(["low", "moderate", "vigorous"]),
  durationMinutes: z.preprocess(
    (val) => (typeof val === "string" ? parseInt(val, 10) : val),
    z.number().int().min(1).max(600)
  ),
  estimatedCalories: optionalInt(z.number().int().min(0).max(5000)),
  dayPerformed: optionalDayOfWeek,
  notes: optionalString(500),
});

// Nutrition adherence schema
export const nutritionAdherenceSchema = z.object({
  daysOnTarget: optionalInt(z.number().int().min(0).max(7)),
  notes: optionalString(1000),
});

/**
 * Validation schema for check-in submission
 * Ensures all numeric values are within acceptable ranges
 * Uses preprocessing to handle null, empty strings, and type coercion
 */
export const submitCheckInSchema = z.object({
  // Subjective metrics (1-10 scale)
  mood: optionalInt(z.number().int().min(1).max(5)),
  energy: optionalInt(z.number().int().min(1).max(10)),
  sleep: optionalInt(z.number().int().min(1).max(10)),
  stress: optionalInt(z.number().int().min(1).max(10)),
  notes: optionalString(5000),

  // Body metrics
  weight: optionalNumber(z.number().positive().max(1000)), // max 1000 lbs/kg
  weightUnit: z.enum(["lbs", "kg"]).optional().nullable().transform((v) => v ?? undefined),
  bodyFatPercentage: optionalNumber(z.number().min(0).max(100)),

  // Body measurements
  waist: optionalNumber(z.number().positive().max(200)), // max 200 in/cm
  hips: optionalNumber(z.number().positive().max(200)),
  chest: optionalNumber(z.number().positive().max(200)),
  arms: optionalNumber(z.number().positive().max(100)),
  thighs: optionalNumber(z.number().positive().max(100)),
  measurementUnit: z.enum(["in", "cm"]).optional().nullable().transform((v) => v ?? undefined),

  // Progress photos (base64 or URLs)
  photoFront: optionalString(10_000_000), // max 10MB base64
  photoSide: optionalString(10_000_000),
  photoBack: optionalString(10_000_000),

  // Training metrics (legacy)
  workoutsCompleted: optionalInt(z.number().int().min(0).max(100)),
  adherencePercentage: optionalNumber(z.number().min(0).max(100)),
  prs: optionalString(1000),
  challenges: optionalString(1000),

  // Enhanced training tracking
  sessionCompletions: z.array(sessionCompletionSchema).max(20).optional().nullable().transform((v) => v ?? undefined),
  exerciseHighlights: z.array(exerciseHighlightSchema).max(10).optional().nullable().transform((v) => v ?? undefined),
  externalActivities: z.array(externalActivitySchema).max(20).optional().nullable().transform((v) => v ?? undefined),
  nutritionAdherence: nutritionAdherenceSchema.optional().nullable().transform((v) => v ?? undefined),

  // Token (required for submission)
  token: z.string().min(1),
});

export type SubmitCheckInInput = z.infer<typeof submitCheckInSchema>;
export type SessionCompletionInput = z.infer<typeof sessionCompletionSchema>;
export type ExerciseHighlightInput = z.infer<typeof exerciseHighlightSchema>;
export type ExternalActivityInput = z.infer<typeof externalActivitySchema>;
export type NutritionAdherenceInput = z.infer<typeof nutritionAdherenceSchema>;
