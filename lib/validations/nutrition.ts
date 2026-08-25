import { z } from "zod";
import { CUSTOM_MACRO_CALORIE_TOLERANCE } from "@/lib/constants";

const activityLevelSchema = z.enum([
  "sedentary",
  "lightly_active",
  "moderately_active",
  "very_active",
  "extremely_active",
]);

const trainingVolumeSchema = z.enum(["0-1", "2-3", "4-5", "6-7", "8+"]);

const dietTypeSchema = z.enum([
  "balanced",
  "high_carb",
  "low_carb",
  "keto",
  "custom",
]);

// Calculator toggles the COACH owns for a given client. No `unitPreference`:
// this is a coach-authenticated route, and a unit preference belongs to the
// person reading the screen, not to the client record being edited. The coach's
// lives on coaches.unit_preference (PATCH /api/coach/settings), the client's on
// clients.unit_preference (PATCH /api/client/settings).
export const nutritionSettingsPatchSchema = z.object({
  includeActivityBurn: z.boolean().optional(),
  surplusAsCarbs: z.boolean().optional(),
}).refine(
  (data) =>
    data.includeActivityBurn !== undefined ||
    data.surplusAsCarbs !== undefined,
  { message: "No valid updates provided" }
);

export const nutritionPlanSchema = z.object({
  // Accepted-but-IGNORED. Activity level is a client fact read from
  // clients.work_activity_level (resolveNutritionCalcInputs); the orchestrator
  // no longer reads this field. Kept optional rather than removed so an
  // in-flight request from an older client build still validates.
  workActivityLevel: activityLevelSchema.optional(),
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
  coachNotes: z.string().max(500).optional(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format").optional(),
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

// Coach per-day edit (events-as-SOT, Session 3 D4 / Session 4). Operates on an
// explicit date LIST (any arrangement — single, scattered, or contiguous), not a
// [start,end] range, so a scattered selection edits exactly the chosen days and
// leaves the gaps untouched. Absolute sets the calorie target outright (optional
// explicit macros); delta scales each day's current total by a percent and/or a
// flat amount. Materialized onto the events.
const editableDates = z
  .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"))
  .min(1, "At least one date is required")
  .max(366, "Too many dates (max 366)");

export const nutritionRangeEditSchema = z
  .object({
    dates: editableDates,
    mode: z.enum(["absolute", "delta"]),
    calories: z.number().int().positive().optional(),
    proteinG: z.number().nonnegative().optional(),
    carbG: z.number().nonnegative().optional(),
    fatG: z.number().nonnegative().optional(),
    percent: z.number().optional(),
    calorieDelta: z.number().optional(),
    // Delta only. Omitted/true = hold protein, rebalance carbs/fat (legacy
    // path, byte-identical); false = scale all three macros onto the new total.
    holdProtein: z.boolean().optional(),
    // Optional coach per-day note. Kept .optional() with NO default so the route
    // can distinguish "omitted" (preserve) from "" (clear) — see RangeEdit D-B.
    note: z.string().max(500).optional(),
  })
  .refine((d) => d.mode !== "absolute" || (d.calories != null && d.calories > 0), {
    message: "absolute mode requires a positive calories value",
    path: ["calories"],
  })
  .refine((d) => d.mode !== "delta" || d.percent != null || d.calorieDelta != null, {
    message: "delta mode requires percent or calorieDelta",
    path: ["percent"],
  });

// Coach multi-day reset (Session 4): clear is_modified on a date list and
// regenerate them from the plan in one call.
export const nutritionResetDaysSchema = z.object({
  dates: editableDates,
});

// Validation function to ensure required client data exists
export function validateClientForNutrition(client: {
  currentWeight?: number;
  bmr?: number;
  tdee?: number;
  gender?: "male" | "female" | "other";
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!client.currentWeight) {
    errors.push("Client must have a current weight recorded");
  }

  if (!client.bmr) {
    errors.push("Client must have BMR calculated");
  }

  // This function accepted `tdee` and never checked it. It matters now: the
  // calculator CONSUMES the profile's TDEE rather than re-deriving it, so a
  // missing one must read as "energy not computed yet" rather than silently
  // falling back to a guess. One helper writes bmr and tdee together, so a row
  // with one and not the other can only predate Session 4B; any weight edit or
  // a save from the client settings dialog repairs it.
  if (!client.tdee) {
    errors.push("Client must have TDEE calculated");
  }

  if (!client.gender) {
    errors.push("Client must have gender specified in profile");
  }

  // No weight-unit check: storage is canonical kilograms since migration 141, so
  // there is no unit to be missing. Keeping it would have marked EVERY client
  // incomplete once callers stopped passing weightUnit — the nutrition tab would
  // render "missing data" and POST /nutrition would 400 platform-wide.

  return {
    valid: errors.length === 0,
    errors,
  };
}
