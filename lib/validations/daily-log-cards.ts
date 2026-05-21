import { z } from "zod";

/**
 * Validation for the per-card daily-log PATCH endpoints (Session 3.1).
 * camelCase + `.strict()` — these are new endpoints; the frontend (Sessions 3.2/3.3)
 * sends camelCase, and unknown keys are rejected rather than silently dropped.
 * Nutrition `target_*` are NOT accepted here — they're resolved server-side.
 */

// Coerce null/undefined/"" → undefined for optional numbers (mirrors lib/validations/daily-log.ts).
const optionalInt = (schema: z.ZodNumber) =>
  z.preprocess((val) => {
    if (val === null || val === undefined || val === "") return undefined;
    const num = typeof val === "string" ? parseInt(val, 10) : val;
    return typeof num === "number" && !isNaN(num) ? num : undefined;
  }, schema.optional());

export const nutritionCardSchema = z
  .object({
    caloriesConsumed: optionalInt(
      z.number().int().min(1, "Calories must be positive").max(10000, "Calories must be reasonable")
    ),
    proteinG: optionalInt(z.number().int().min(0, "Protein must be positive").max(1000, "Protein must be reasonable")),
    carbsG: optionalInt(z.number().int().min(0, "Carbs must be positive").max(2000, "Carbs must be reasonable")),
    fatG: optionalInt(z.number().int().min(0, "Fat must be positive").max(500, "Fat must be reasonable")),
  })
  .strict();

export const wellnessCardSchema = z
  .object({
    mood: optionalInt(z.number().int().min(1, "Mood must be between 1-5").max(5, "Mood must be between 1-5")),
    energy: optionalInt(z.number().int().min(1, "Energy must be between 1-10").max(10, "Energy must be between 1-10")),
    sleep: optionalInt(z.number().int().min(1, "Sleep must be between 1-10").max(10, "Sleep must be between 1-10")),
    stress: optionalInt(z.number().int().min(1, "Stress must be between 1-10").max(10, "Stress must be between 1-10")),
  })
  .strict();

export type NutritionCardInput = z.infer<typeof nutritionCardSchema>;
export type WellnessCardInput = z.infer<typeof wellnessCardSchema>;

/**
 * Format-only validation for the `[date]` route param: a real YYYY-MM-DD.
 * No past/future bounds — those are write-side via canEditDay (a future day is viewable
 * read-only; an old day may be viewed/locked). Do NOT use validateDateParameter here.
 */
export const isValidDateParam = (s: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00`));
