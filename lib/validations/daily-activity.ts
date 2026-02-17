import { z } from "zod";

// Helper to handle null/undefined/empty string as undefined for optional integers
const optionalInt = (schema: z.ZodNumber) =>
  z.preprocess(
    (val) => {
      if (val === null || val === undefined || val === "") return undefined;
      const num = typeof val === "string" ? parseInt(val, 10) : val;
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

// Date validation helper - not in future
const futureDateValidation = z.string().refine(
  (date) => {
    const logDate = new Date(date);
    const today = new Date();
    today.setHours(23, 59, 59, 999); // End of today
    
    return logDate <= today;
  },
  {
    message: "Date cannot be in the future"
  }
);

/**
 * Validation schema for daily external activity submission
 * For clients to log activities outside their training plan
 */
export const dailyExternalActivitySchema = z.object({
  date: futureDateValidation,
  activityName: z.string().min(1, "Activity name is required").max(100, "Activity name must be 100 characters or less"),
  intensityLevel: z.enum(["low", "moderate", "vigorous"], {
    errorMap: () => ({ message: "Intensity must be low, moderate, or vigorous" })
  }),
  durationMinutes: z.preprocess(
    (val) => (typeof val === "string" ? parseInt(val, 10) : val),
    z.number().int().min(1, "Duration must be at least 1 minute").max(600, "Duration must be 10 hours or less")
  ),
  estimatedCalories: optionalInt(z.number().int().min(1, "Estimated calories must be positive").max(5000, "Estimated calories must be reasonable")),
  notes: optionalString(500),
});