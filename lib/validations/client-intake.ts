import { z } from "zod";

// -------------------------------------------------------
// Enum schemas
// -------------------------------------------------------

export const primaryGoalSchema = z.enum([
  "lose_weight",
  "build_muscle",
  "recomposition",
  "general_fitness",
  "event_prep",
  "maintain",
]);

export const workActivityLevelSchema = z.enum([
  "sedentary",
  "lightly_active",
  "moderately_active",
  "very_active",
  "extremely_active",
]);

export const trainingLocationSchema = z.enum([
  "commercial_gym",
  "home_gym",
  "home_no_equipment",
  "outdoor",
  "mixed",
]);

export const trainingTimePreferenceSchema = z.enum([
  "morning",
  "midday",
  "evening",
  "flexible",
]);

export const cookingFrequencySchema = z.enum([
  "mostly_cook",
  "mix_of_both",
  "mostly_eat_out",
  "meal_prep",
]);

export const trainingExperienceSchema = z.enum([
  "complete_beginner",
  "some_experience",
  "intermediate",
  "advanced",
]);

// -------------------------------------------------------
// Helper: preprocess null/empty to undefined
// -------------------------------------------------------

const optionalString = (maxLength: number) =>
  z.preprocess(
    (val) => (val === null || val === "" ? undefined : val),
    z.string().max(maxLength).optional()
  );

const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess(
    (val) => {
      if (val === null || val === undefined || val === "") return undefined;
      const num = typeof val === "string" ? parseFloat(val) : val;
      return typeof num === "number" && !isNaN(num) ? num : undefined;
    },
    schema.optional()
  );

const optionalInt = (schema: z.ZodNumber) =>
  z.preprocess(
    (val) => {
      if (val === null || val === undefined || val === "") return undefined;
      const num = typeof val === "string" ? parseInt(val, 10) : val;
      return typeof num === "number" && !isNaN(num) ? num : undefined;
    },
    schema.optional()
  );

const optionalBoolean = z.preprocess(
  (val) => {
    if (val === null || val === undefined) return undefined;
    if (typeof val === "boolean") return val;
    if (val === "true") return true;
    if (val === "false") return false;
    return undefined;
  },
  z.boolean().optional()
);

// -------------------------------------------------------
// Step 1: Body & Lifestyle
// -------------------------------------------------------

export const intakeStep1Schema = z.object({
  dateOfBirth: z
    .string()
    .min(1, "Date of birth is required")
    .refine(
      (val) => {
        const dob = new Date(val);
        const now = new Date();
        const age = now.getFullYear() - dob.getFullYear();
        // Adjust for month/day
        const monthDiff = now.getMonth() - dob.getMonth();
        const adjustedAge =
          monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())
            ? age - 1
            : age;
        return adjustedAge >= 16;
      },
      { message: "Must be at least 16 years old" }
    )
    .refine(
      (val) => {
        const dob = new Date(val);
        const now = new Date();
        const age = now.getFullYear() - dob.getFullYear();
        return age <= 100;
      },
      { message: "Must be under 100 years old" }
    ),
  gender: z.string().min(1, "Gender is required"),
  height: z.number().positive("Height must be positive").min(100, "Height must be at least 100cm").max(250, "Height must be under 250cm"),
  currentWeight: z.number().positive("Weight must be positive").min(30, "Weight must be at least 30kg").max(300, "Weight must be under 300kg"),
  bodyFatPercentage: optionalNumber(z.number().min(3, "Body fat must be at least 3%").max(60, "Body fat must be under 60%")),
});

// -------------------------------------------------------
// Step 2: Goals
// -------------------------------------------------------

export const intakeStep2Schema = z
  .object({
    primaryGoal: primaryGoalSchema,
    targetWeight: optionalNumber(z.number().positive().min(30).max(300)),
    goalDeadline: optionalString(50).refine(
      (val) => {
        if (!val) return true;
        const deadline = new Date(val);
        const now = new Date();
        if (deadline <= now) return false;
        const twoYearsOut = new Date();
        twoYearsOut.setFullYear(twoYearsOut.getFullYear() + 2);
        return deadline <= twoYearsOut;
      },
      { message: "Deadline must be in the future and within 2 years" }
    ),
    goalDescription: optionalString(500),
    motivation: optionalString(500),
  })
  .refine(
    (data) => {
      if (
        (data.primaryGoal === "lose_weight" ||
          data.primaryGoal === "build_muscle") &&
        !data.targetWeight
      ) {
        return false;
      }
      return true;
    },
    {
      message: "Target weight is required for weight loss or muscle building goals",
      path: ["targetWeight"],
    }
  );

// -------------------------------------------------------
// Step 3: Training
// -------------------------------------------------------

export const intakeStep3Schema = z.object({
  workActivityLevel: workActivityLevelSchema,
  daysPerWeek: z
    .number()
    .int("Must be a whole number")
    .min(1, "At least 1 day per week")
    .max(7, "Maximum 7 days per week"),
  trainingTimePreference: trainingTimePreferenceSchema,
  trainingLocation: trainingLocationSchema,
  availableEquipment: z.array(z.string().max(100)).max(20).optional(),
  sessionDurationMinutes: optionalInt(
    z
      .number()
      .int()
      .min(15, "Session must be at least 15 minutes")
      .max(180, "Session must be under 180 minutes")
  ),
});

// -------------------------------------------------------
// Step 4: Nutrition
// -------------------------------------------------------

export const intakeStep4Schema = z.object({
  dietaryRequirements: z.array(z.string().max(100)).max(20).optional(),
  foodAllergies: optionalString(300),
  dietDescription: optionalString(500),
  cookingFrequency: cookingFrequencySchema.optional(),
  hasTrackedMacrosBefore: optionalBoolean,
  mealsPerDay: optionalInt(
    z
      .number()
      .int()
      .min(1, "At least 1 meal per day")
      .max(8, "Maximum 8 meals per day")
  ),
  biggestNutritionChallenge: optionalString(500),
});

// -------------------------------------------------------
// Step 5: Medical & Background
// -------------------------------------------------------

export const intakeStep5Schema = z.object({
  injuriesOrLimitations: optionalString(500),
  trainingExperienceLevel: trainingExperienceSchema,
  previousCoachingExperience: optionalBoolean,
  previousCoachingDetails: optionalString(500),
  anythingElse: optionalString(1000),
});

// -------------------------------------------------------
// Full intake schema (merge of all steps)
// -------------------------------------------------------

// Step 2 has a .refine(), so we extract the base shape for merging
const intakeStep2BaseSchema = z.object({
  primaryGoal: primaryGoalSchema,
  targetWeight: optionalNumber(z.number().positive().min(30).max(300)),
  goalDeadline: optionalString(50),
  goalDescription: optionalString(500),
  motivation: optionalString(500),
});

export const intakeFullSchema = intakeStep1Schema
  .merge(intakeStep2BaseSchema)
  .merge(intakeStep3Schema)
  .merge(intakeStep4Schema)
  .merge(intakeStep5Schema)
  .refine(
    (data) => {
      if (
        (data.primaryGoal === "lose_weight" ||
          data.primaryGoal === "build_muscle") &&
        !data.targetWeight
      ) {
        return false;
      }
      return true;
    },
    {
      message: "Target weight is required for weight loss or muscle building goals",
      path: ["targetWeight"],
    }
  );

// -------------------------------------------------------
// Step schema map (for dynamic step validation)
// -------------------------------------------------------

export const intakeStepSchemas = [
  intakeStep1Schema,
  intakeStep2Schema,
  intakeStep3Schema,
  intakeStep4Schema,
  intakeStep5Schema,
] as const;

// -------------------------------------------------------
// Inferred types
// -------------------------------------------------------

export type IntakeStep1Input = z.infer<typeof intakeStep1Schema>;
export type IntakeStep2Input = z.infer<typeof intakeStep2Schema>;
export type IntakeStep3Input = z.infer<typeof intakeStep3Schema>;
export type IntakeStep4Input = z.infer<typeof intakeStep4Schema>;
export type IntakeStep5Input = z.infer<typeof intakeStep5Schema>;
export type IntakeFullInput = z.infer<typeof intakeFullSchema>;
