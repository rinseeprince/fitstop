import { z } from "zod";
import { CUSTOM_MACRO_CALORIE_TOLERANCE } from "@/lib/constants";

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

const dayCalorieOverrideSchema = z.object({
  calories: z.number().positive(),
  protein_g: z.number().nonnegative(),
  carbs_g: z.number().nonnegative(),
  fat_g: z.number().nonnegative(),
});

export const dayCalorieOverridesSchema = z.object({
  monday: dayCalorieOverrideSchema,
  tuesday: dayCalorieOverrideSchema,
  wednesday: dayCalorieOverrideSchema,
  thursday: dayCalorieOverrideSchema,
  friday: dayCalorieOverrideSchema,
  saturday: dayCalorieOverrideSchema,
  sunday: dayCalorieOverrideSchema,
});

export const nutritionSettingsPatchSchema = z.object({
  unitPreference: unitPreferenceSchema.optional(),
  includeActivityBurn: z.boolean().optional(),
}).refine(
  (data) =>
    data.unitPreference !== undefined ||
    data.includeActivityBurn !== undefined,
  { message: "No valid updates provided" }
);

export const nutritionPlanSchema = z.object({
  workActivityLevel: activityLevelSchema,
  trainingVolumeHours: trainingVolumeSchema.optional(), // Now optional - auto-calculated from training plan
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
  customCalories: z.number().positive().optional(),
  phaseId: z.string().uuid().optional(),
  coachNotes: z.string().max(500).optional(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format").optional(),
  preserveCalories: z.boolean().optional(),
  dayCalorieOverrides: dayCalorieOverridesSchema.optional(),
}).refine(
  (data) => {
    // If custom macros are enabled, validate that custom calories match macro totals
    if (data.customMacrosEnabled && data.customCalories && data.customProteinG && data.customCarbG && data.customFatG) {
      const calculatedCalories = (data.customProteinG * 4) + (data.customCarbG * 4) + (data.customFatG * 9);
      const difference = Math.abs(data.customCalories - calculatedCalories);
      return difference <= CUSTOM_MACRO_CALORIE_TOLERANCE;
    }
    return true;
  },
  {
    message: "Custom calories must be within ±50 calories of macro totals (Protein×4 + Carbs×4 + Fat×9)",
    path: ["customCalories"],
  }
);

export const updateUnitPreferenceSchema = z.object({
  unitPreference: unitPreferenceSchema,
});

// Coach per-day range edit (events-as-SOT, Session 3 D4). Absolute sets the
// calorie target outright (optional explicit macros); delta scales each day's
// current total by a percent and/or a flat amount. Materialized onto the events.
export const nutritionRangeEditSchema = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
    mode: z.enum(["absolute", "delta"]),
    calories: z.number().int().positive().optional(),
    proteinG: z.number().nonnegative().optional(),
    carbG: z.number().nonnegative().optional(),
    fatG: z.number().nonnegative().optional(),
    percent: z.number().optional(),
    calorieDelta: z.number().optional(),
  })
  .refine((d) => d.endDate >= d.startDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
  })
  .refine((d) => d.mode !== "absolute" || (d.calories != null && d.calories > 0), {
    message: "absolute mode requires a positive calories value",
    path: ["calories"],
  })
  .refine((d) => d.mode !== "delta" || d.percent != null || d.calorieDelta != null, {
    message: "delta mode requires percent or calorieDelta",
    path: ["percent"],
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
