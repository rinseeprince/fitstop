import type { ActivityLevel } from "@/types/check-in";

/**
 * The one place the activity ladder's coach-facing wording lives. It used to be
 * inlined in the nutrition drawer's dropdown, which was also the only place a
 * coach could set it — so moving the control to the client profile would
 * otherwise have meant two copies of these strings drifting apart.
 */
export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: "Sedentary (desk job)",
  lightly_active: "Lightly active (light movement)",
  moderately_active: "Moderately active (on feet most of day)",
  very_active: "Very active (physical job)",
  extremely_active: "Extremely active (athlete/heavy labor)",
};
