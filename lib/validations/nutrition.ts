import { z } from "zod";

export const activityLevelSchema = z.enum([
  "sedentary",
  "lightly_active",
  "moderately_active",
  "very_active",
  "extremely_active",
]);

export const trainingVolumeSchema = z.enum(["0-1", "2-3", "4-5", "6-7", "8+"]);

export const dietTypeSchema = z.enum([
  "balanced",
  "high_carb",
  "low_carb",
  "keto",
  "custom",
]);

export const unitPreferenceSchema = z.enum(["metric", "imperial"]);

export const nutritionPlanSchema = z.object({
  workActivityLevel: activityLevelSchema,
  trainingVolumeHours: trainingVolumeSchema,
  proteinTargetGPerKg: z
    .number()
    .min(1.0, "Protein target must be at least 1.0g/kg")
    .max(3.0, "Protein target cannot exceed 3.0g/kg"),
  dietType: dietTypeSchema,
  goalDeadline: z.string().optional(),
  customMacrosEnabled: z.boolean().optional(),
  customProteinG: z.number().positive().optional(),
  customCarbG: z.number().positive().optional(),
  customFatG: z.number().positive().optional(),
});

export const updateUnitPreferenceSchema = z.object({
  unitPreference: unitPreferenceSchema,
});

// Validation function to ensure required client data exists
export function validateClientForNutrition(client: {
  currentWeight?: number;
  bmr?: number;
  tdee?: number;
  gender?: "male" | "female" | "other";
  weightUnit?: "lbs" | "kg";
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!client.currentWeight) {
    errors.push("Client must have a current weight recorded");
  }

  if (!client.bmr) {
    errors.push("Client must have BMR calculated (use Calculate BMR button)");
  }

  if (!client.tdee) {
    errors.push("Client must have TDEE calculated (use Calculate BMR button)");
  }

  if (!client.gender) {
    errors.push("Client must have gender specified in profile");
  }

  if (!client.weightUnit) {
    errors.push("Client must have weight unit set");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
