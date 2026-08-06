import { z } from "zod";
import { WEIGHT_KG_MAX, WEIGHT_KG_MIN } from "@/lib/constants";

// Weights are canonical KILOGRAMS on the wire and in storage (migration 141).
//
// currentWeight/goalWeight were `.min(20).max(700)` — a pounds range left in
// place when storage flipped to kilograms, so the schema accepted 699 kg. It
// only looked harmless because app/api/clients/[id]/metrics/route.ts narrowed
// the same quantity to 20-250 kg inline, which was itself a second copy of the
// threshold. Both now read WEIGHT_KG_MIN/MAX.
export const updateClientMetricsSchema = z.object({
  currentWeight: z.number().min(WEIGHT_KG_MIN).max(WEIGHT_KG_MAX).optional(),
  currentBodyFatPercentage: z.number().min(3).max(60).optional(),
  goalWeight: z.number().min(WEIGHT_KG_MIN).max(WEIGHT_KG_MAX).optional(),
  goalBodyFatPercentage: z.number().min(3).max(60).optional(),
  bmr: z.number().min(800).max(5000).optional(),
  tdee: z.number().min(1000).max(8000).optional(),
  bmrManualOverride: z.boolean().optional(),
  tdeeManualOverride: z.boolean().optional(),
  saveOption: z.enum(["update", "check-in"]).optional(),
}).strict();
