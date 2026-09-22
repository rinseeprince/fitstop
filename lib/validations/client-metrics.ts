import { z } from "zod";
import { WEIGHT_KG_MAX, WEIGHT_KG_MIN } from "@/lib/constants";

// Weights are canonical KILOGRAMS on the wire and in storage (migration 141),
// bounded by WEIGHT_KG_MIN/MAX — the one copy of the range; the route does not
// repeat it.
export const updateClientMetricsSchema = z.object({
  currentWeight: z.number().min(WEIGHT_KG_MIN).max(WEIGHT_KG_MAX).optional(),
  currentBodyFatPercentage: z.number().min(3).max(60).optional(),
  bmr: z.number().min(800).max(5000).optional(),
  tdee: z.number().min(1000).max(8000).optional(),
  bmrManualOverride: z.boolean().optional(),
  tdeeManualOverride: z.boolean().optional(),
}).strict();
