import { z } from "zod";
import { optionalString } from "@/lib/validations/intake-steps";

// Re-export step schemas so existing consumers don't break
export {
  intakeStepSchemas,
  intakeFullSchema,
  intakeStep1Schema,
  intakeStep2Schema,
  intakeStep3Schema,
  intakeStep4Schema,
  intakeStep5Schema,
  primaryGoalSchema,
  workActivityLevelSchema,
  trainingLocationSchema,
  trainingTimePreferenceSchema,
  cookingFrequencySchema,
  trainingExperienceSchema,
} from "@/lib/validations/intake-steps";

export type {
  IntakeStep1Input,
  IntakeStep2Input,
  IntakeStep3Input,
  IntakeStep4Input,
  IntakeStep5Input,
  IntakeFullInput,
} from "@/lib/validations/intake-steps";

// -------------------------------------------------------
// API route validation schemas
// -------------------------------------------------------

export const reviewIntakeSchema = z.object({
  coachReviewNotes: optionalString(2000),
});

const VALID_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export const activateClientSchema = z.object({
  welcomeMessage: optionalString(1000),
  firstCheckInDay: z.enum(VALID_DAYS).optional(),
});

export const intakeActionSchema = z.object({
  action: z.enum(["review", "sync-metrics"]),
  notes: optionalString(2000),
});
