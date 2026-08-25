import { z } from "zod";
import {
  GIRTH_LIMB_CM_MAX,
  GIRTH_TORSO_CM_MAX,
  LOAD_KG_MAX,
  WEIGHT_KG_MAX,
  WEIGHT_KG_MIN,
} from "@/lib/constants";

const VALID_DAYS =["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

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
  trainingSessionId: z.string().min(1).max(100),
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
  // A lifted LOAD, not a body weight — canonical kilograms, own ceiling.
  weightValue: optionalNumber(z.number().positive().max(LOAD_KG_MAX)),
  weightUnit: z.enum(["lbs", "kg"]).optional().nullable().transform((v) => v ?? undefined),
  reps: optionalInt(z.number().int().min(1).max(1000)),
}).superRefine((data, ctx) => {
  if (data.weightValue !== undefined && data.weightUnit === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["weightUnit"],
      message: "weightUnit is required when weightValue is present",
    });
  }
});

// Nutrition adherence schema
export const nutritionAdherenceSchema = z.object({
  daysOnTarget: optionalInt(z.number().int().min(0).max(30)), // Max 30 for monthly check-ins
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

  // Body metrics — canonical KILOGRAMS. The web form converts from the
  // viewer's preference before submitting (toCanonicalCheckInSubmission), so
  // the ceiling can finally describe storage rather than standing in for two
  // units at once ("max 1000 lbs/kg", which is what it said).
  weight: optionalNumber(z.number().min(WEIGHT_KG_MIN).max(WEIGHT_KG_MAX)),
  weightUnit: z.enum(["lbs", "kg"]).optional().nullable().transform((v) => v ?? undefined),
  bodyFatPercentage: optionalNumber(z.number().min(0).max(100)),

  // Body measurements — canonical CENTIMETRES. Values unchanged; they read
  // correctly as centimetres and were merely labelled "in/cm". Safe to name
  // ahead of the form conversion, unlike weight above: an inches value is
  // numerically SMALLER than the centimetres it becomes, so a cm ceiling
  // cannot reject an inches payload.
  waist: optionalNumber(z.number().positive().max(GIRTH_TORSO_CM_MAX)),
  hips: optionalNumber(z.number().positive().max(GIRTH_TORSO_CM_MAX)),
  chest: optionalNumber(z.number().positive().max(GIRTH_TORSO_CM_MAX)),
  arms: optionalNumber(z.number().positive().max(GIRTH_LIMB_CM_MAX)),
  thighs: optionalNumber(z.number().positive().max(GIRTH_LIMB_CM_MAX)),
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
  nutritionAdherence: nutritionAdherenceSchema.optional().nullable().transform((v) => v ?? undefined),
}).superRefine((data, ctx) => {
  // A unit tag is REQUIRED alongside the value it describes.
  //
  // Both tags used to be freely optional, and the server picked a default for
  // an untagged payload: kg for a weight, INCHES for a girth. Two different
  // guesses about the same silence, either of which writes a number that is
  // indistinguishable afterwards from a correct one. Rejecting is the only
  // honest answer — the sender knows what they measured and we do not.
  //
  // Nothing is lost for the web form, which converts to canonical kg/cm and
  // tags the payload itself (utils/check-in-canonical-metrics.ts). This is
  // what makes a non-web client's own units safe rather than a coin flip.
  if (data.weight !== undefined && data.weightUnit === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["weightUnit"],
      message: "weightUnit is required when weight is present",
    });
  }

  const hasGirth = [data.waist, data.hips, data.chest, data.arms, data.thighs]
    .some((value) => value !== undefined);
  if (hasGirth && data.measurementUnit === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["measurementUnit"],
      message: "measurementUnit is required when a measurement is present",
    });
  }
});

export const clientSubmitCheckInSchema = submitCheckInSchema.refine(
    (data) => {
      const meaningfulFields = [
        data.mood, data.energy, data.sleep, data.stress,
        data.weight, data.notes,
        data.sessionCompletions, data.exerciseHighlights,
        data.nutritionAdherence,
      ];
      return meaningfulFields.some((field) => field !== undefined);
    },
    { message: "Check-in must include at least one data field" }
  );

// AI summary request validation
export const aiSummaryRequestSchema = z.object({
  focus: z.enum(["positive", "detailed", "concise"]).optional(),
});

export const reviewCheckInSchema = z.object({
  coachResponse: z.string().min(1, "Coach response is required").max(10000),
});
