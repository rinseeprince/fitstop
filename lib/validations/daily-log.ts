import { z } from "zod";

// Helper to handle null/undefined/empty string as undefined for optional numbers
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

// Date validation helper - not in future, max 30 days old
const dailyLogDateSchema = z.string().refine(
  (date) => {
    const logDate = new Date(date);
    const today = new Date();
    today.setHours(23, 59, 59, 999); // End of today
    
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);
    
    return logDate <= today && logDate >= thirtyDaysAgo;
  },
  {
    message: "Date must not be in the future and not older than 30 days"
  }
);

/**
 * Validation schema for daily log submission
 * Ensures all numeric values are within acceptable ranges
 * Uses preprocessing to handle null, empty strings, and type coercion
 */
export const dailyLogSchema = z.object({
  date: dailyLogDateSchema,
  
  // Subjective metrics
  mood: optionalInt(z.number().int().min(1, "Mood must be between 1-5").max(5, "Mood must be between 1-5")),
  energy: optionalInt(z.number().int().min(1, "Energy must be between 1-10").max(10, "Energy must be between 1-10")),
  sleep: optionalInt(z.number().int().min(1, "Sleep must be between 1-10").max(10, "Sleep must be between 1-10")),
  stress: optionalInt(z.number().int().min(1, "Stress must be between 1-10").max(10, "Stress must be between 1-10")),
  notes: optionalString(5000),
  
  // Training tracking
  trained: z.boolean().optional(),
  trainingSessionId: z.string().uuid().optional().nullable().transform((v) => v ?? undefined),
  
  // Nutrition tracking (calories_consumed is optional - client may log wellness without calories)
  caloriesConsumed: optionalInt(z.number().int().min(1, "Calories must be positive").max(10000, "Calories must be reasonable")),
  proteinG: optionalInt(z.number().int().min(0, "Protein must be positive").max(1000, "Protein must be reasonable")),
  carbsG: optionalInt(z.number().int().min(0, "Carbs must be positive").max(2000, "Carbs must be reasonable")),
  fatG: optionalInt(z.number().int().min(0, "Fat must be positive").max(500, "Fat must be reasonable")),
});