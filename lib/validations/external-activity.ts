import { z } from "zod";
import { dayOfWeekSchema } from "./training";

export const intensityLevelSchema = z.enum(["low", "moderate", "vigorous"]);

export const muscleGroupSchema = z.enum([
  "legs",
  "back",
  "chest",
  "shoulders",
  "arms",
  "core",
  "cardio",
  "grip",
  "full_body",
]);

export const addExternalActivitySchema = z.object({
  activityName: z
    .string()
    .min(2, "Activity name must be at least 2 characters")
    .max(100, "Activity name too long"),
  dayOfWeek: dayOfWeekSchema,
  intensityLevel: intensityLevelSchema,
  durationMinutes: z
    .number()
    .int()
    .min(10, "Minimum duration is 10 minutes")
    .max(480, "Maximum duration is 8 hours"),
  notes: z.string().max(500).optional().nullable(),
});

export const updateExternalActivitySchema = z.object({
  activityName: z.string().min(2).max(100).optional(),
  dayOfWeek: dayOfWeekSchema.optional(),
  intensityLevel: intensityLevelSchema.optional(),
  durationMinutes: z.number().int().min(10).max(480).optional(),
  notes: z.string().max(500).optional().nullable(),
});

export const analyzeActivitySchema = z.object({
  activityName: z.string().min(2).max(100),
  intensityLevel: intensityLevelSchema,
  durationMinutes: z.number().int().min(10).max(480),
  clientWeightKg: z.number().min(30).max(300),
});

export const activitySuggestionsQuerySchema = z.object({
  q: z.string().min(1).max(50).optional(),
  limit: z.coerce.number().int().min(1).max(20).optional().default(10),
});
