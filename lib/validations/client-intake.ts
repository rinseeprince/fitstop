import { z } from "zod";
import { optionalString } from "@/lib/validations/intake-steps";

// -------------------------------------------------------
// API route validation schemas
// -------------------------------------------------------

export const reviewIntakeSchema = z.object({
  coachReviewNotes: optionalString(2000),
});

export const activateClientSchema = z.object({
  welcomeMessage: optionalString(1000),
  firstCheckInDue: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")
    .optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const intakeActionSchema = z.object({
  action: z.enum(["review", "sync-metrics"]),
  notes: optionalString(2000),
});
