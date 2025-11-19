import { z } from "zod";

/**
 * Validation schema for check-in submission
 * Ensures all numeric values are within acceptable ranges
 */
export const submitCheckInSchema = z.object({
  // Subjective metrics (1-10 scale)
  mood: z.number().int().min(1).max(5).optional(),
  energy: z.number().int().min(1).max(10).optional(),
  sleep: z.number().int().min(1).max(10).optional(),
  stress: z.number().int().min(1).max(10).optional(),
  notes: z.string().max(5000).optional(),

  // Body metrics
  weight: z.number().positive().max(1000).optional(), // max 1000 lbs/kg
  weightUnit: z.enum(["lbs", "kg"]).optional(),
  bodyFatPercentage: z.number().min(0).max(100).optional(),

  // Body measurements
  waist: z.number().positive().max(200).optional(), // max 200 in/cm
  hips: z.number().positive().max(200).optional(),
  chest: z.number().positive().max(200).optional(),
  arms: z.number().positive().max(100).optional(),
  thighs: z.number().positive().max(100).optional(),
  measurementUnit: z.enum(["in", "cm"]).optional(),

  // Progress photos (base64 or URLs)
  photoFront: z.string().max(10_000_000).optional(), // max 10MB base64
  photoSide: z.string().max(10_000_000).optional(),
  photoBack: z.string().max(10_000_000).optional(),

  // Training metrics
  workoutsCompleted: z.number().int().min(0).max(100).optional(), // max 100 workouts per period
  adherencePercentage: z.number().min(0).max(100).optional(),
  prs: z.string().max(1000).optional(), // Personal records/wins
  challenges: z.string().max(1000).optional(), // Challenges faced

  // Token (required for submission)
  token: z.string().min(1),
});

export type SubmitCheckInInput = z.infer<typeof submitCheckInSchema>;
