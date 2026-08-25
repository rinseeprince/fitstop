import { z } from "zod";
import { optionalString } from "@/lib/validations/intake-steps";

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
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const intakeActionSchema = z.object({
  action: z.enum(["review", "sync-metrics"]),
  notes: optionalString(2000),
});
