import type { MeasurementKey } from "@/lib/measurements/keys";
import type { WellnessKey } from "@/lib/wellness/keys";

// The metric's good direction on the Journey: a falling value reads as
// improvement for these (the body metrics, plus the shared chart's
// stress/soreness inversion).
export const DOWN_IS_GOOD: ReadonlySet<MeasurementKey | WellnessKey> = new Set<
  MeasurementKey | WellnessKey
>(["weight", "bodyFat", "waist", "hips", "chest", "arms", "thighs", "stress", "soreness"]);
