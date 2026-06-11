import { z } from "zod";

// Helper to handle null/undefined/empty string as undefined for optional numbers
const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess(
    (val) => {
      if (val === null || val === undefined || val === "") return undefined;
      const num = typeof val === "string" ? parseFloat(val) : val;
      return typeof num === "number" && !isNaN(num) ? num : undefined;
    },
    schema.optional()
  );

// Helper to handle null/undefined/empty string as undefined for optional strings
const optionalString = (maxLength: number) =>
  z.preprocess(
    (val) => (val === null || val === "" ? undefined : val),
    z.string().max(maxLength).optional()
  );

// Format-only date validation: a YYYY-MM-DD string. No past/future bounds —
// those are write-side via assertCanEdit/canEditDay, which judge against the
// CLIENT's timezone. A server-clock bound here rejects an east-of-UTC client's
// own today as "future" (see lib/validations/daily-log-cards.ts for the same
// rule on the read path).
const logDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format");

/**
 * Validation schema for creating daily habits
 * For coaches to define habits for their clients to track
 */
export const dailyHabitSchema = z.object({
  name: z.string().min(1, "Habit name is required").max(100, "Habit name must be 100 characters or less"),
  description: optionalString(500),
  targetValue: optionalNumber(z.number().positive("Target value must be positive")),
  targetUnit: optionalString(30),
  isBoolean: z.boolean(),
  phaseId: z.string().uuid().optional(),
});

/**
 * Validation schema for daily habit log submission
 * For clients to log their habit completion
 */
export const dailyHabitLogSchema = z.object({
  dailyHabitId: z.string().uuid("Invalid habit ID"),
  date: logDateSchema,
  completed: z.boolean(),
  value: optionalNumber(z.number().positive("Value must be positive")),
  notes: optionalString(500),
});