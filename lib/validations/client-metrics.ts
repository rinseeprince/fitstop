import { z } from "zod";

export const updateClientMetricsSchema = z.object({
  currentWeight: z.number().min(20).max(700).optional(),
  currentBodyFatPercentage: z.number().min(3).max(60).optional(),
  goalWeight: z.number().min(20).max(700).optional(),
  goalBodyFatPercentage: z.number().min(3).max(60).optional(),
  bmr: z.number().min(800).max(5000).optional(),
  tdee: z.number().min(1000).max(8000).optional(),
  bmrManualOverride: z.boolean().optional(),
  tdeeManualOverride: z.boolean().optional(),
  saveOption: z.enum(["update", "check-in"]).optional(),
}).strict();
