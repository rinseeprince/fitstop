import { z } from "zod";

export const splitTypeSchema = z.enum([
  "push_pull_legs",
  "upper_lower",
  "full_body",
  "bro_split",
  "push_pull",
  "custom",
]);

export const planStatusSchema = z.enum(["active", "archived", "draft"]);

export const dayOfWeekSchema = z.enum([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

export const exerciseSchema = z.object({
  name: z.string().min(1, "Exercise name is required"),
  sets: z.number().int().min(1, "At least 1 set required").max(20, "Maximum 20 sets"),
  repsMin: z.number().int().min(1).max(100).optional().nullable(),
  repsMax: z.number().int().min(1).max(100).optional().nullable(),
  repsTarget: z.string().max(20).optional().nullable(),
  rpeTarget: z.number().min(1).max(10).optional().nullable(),
  percentage1rm: z.number().min(0).max(100).optional().nullable(),
  tempo: z.string().max(20).optional().nullable(),
  restSeconds: z.number().int().min(0).max(600).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  supersetGroup: z.string().max(10).optional().nullable(),
  isWarmup: z.boolean().optional().default(false),
});

export const sessionSchema = z.object({
  name: z.string().min(1, "Session name is required").max(100),
  dayOfWeek: dayOfWeekSchema.optional().nullable(),
  orderIndex: z.number().int().min(0).optional(),
  focus: z.string().max(200).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  estimatedDurationMinutes: z.number().int().min(10).max(180).optional().nullable(),
});

// Activity analysis from API (nested in pre-generation activity)
export const activityAnalysisSchema = z.object({
  estimatedCalories: z.number(),
  metValue: z.number(),
  recoveryImpact: z.string(),
  recoveryHours: z.number(),
  muscleGroupsImpacted: z.array(z.string()),
  trainingRecommendations: z.array(z.string()),
});

// Pre-generation activity schema
export const preGenerationActivitySchema = z.object({
  tempId: z.string(),
  activityName: z.string().min(1, "Activity name is required").max(100),
  dayOfWeek: dayOfWeekSchema,
  intensityLevel: z.enum(["low", "moderate", "vigorous"]),
  durationMinutes: z.number().int().min(10, "Minimum 10 minutes").max(480, "Maximum 8 hours"),
  notes: z.string().max(500).optional().nullable(),
  analysis: activityAnalysisSchema.optional().nullable(),
});

export const generateTrainingPlanSchema = z.object({
  coachPrompt: z
    .string()
    .min(10, "Please provide more detail in your prompt (at least 10 characters)")
    .max(2000, "Prompt is too long (maximum 2000 characters)"),
  preGenerationActivities: z.array(preGenerationActivitySchema).optional(),
  allowSameDayTraining: z.boolean().optional().default(false),
});

export const updateTrainingPlanSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  status: planStatusSchema.optional(),
  frequencyPerWeek: z.number().int().min(1).max(7).optional(),
  programDurationWeeks: z.number().int().min(1).max(52).optional().nullable(),
});

export const updateSessionSchema = sessionSchema.partial();

export const updateExerciseSchema = exerciseSchema.partial();

// Schema for bulk reordering sessions
export const reorderSessionSchema = z.object({
  sessionId: z.string().uuid(),
  dayOfWeek: dayOfWeekSchema.optional().nullable(),
  orderIndex: z.number().int().min(0),
});

export const reorderSessionsSchema = z.array(reorderSessionSchema);

export const addSessionSchema = sessionSchema;

export const addExerciseSchema = exerciseSchema;

// Validation function to ensure client has basic data for training plan
export function validateClientForTraining(client: {
  currentWeight?: number;
  goalWeight?: number;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!client.currentWeight) {
    errors.push("Client must have a current weight recorded");
  }

  // Goal weight is helpful but not strictly required
  if (!client.goalWeight) {
    errors.push("Client should have a goal weight set for better recommendations");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
