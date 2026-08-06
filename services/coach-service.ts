import { supabaseAdmin } from "./supabase-admin";
import { mapCoachRow } from "@/lib/mappers";
import type { Coach } from "@/types/check-in";
import type { UpdateCoachSettingsInput } from "@/lib/validations/coach";

// Update coach-controlled settings (PATCH /api/coach/settings).
// Mirrors updateClientSettings in client-service.ts, including its
// write-only-what-was-supplied shape: the timezone auto-sync and the settings
// units card each send one field, so an unconditional write would have the
// later request null out whatever the other had just set.
export const updateCoachSettings = async (
  coachId: string,
  settings: UpdateCoachSettingsInput
): Promise<Coach> => {
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (settings.timezone !== undefined) {
    updateData.timezone = settings.timezone;
  }

  if (settings.unitPreference !== undefined) {
    updateData.unit_preference = settings.unitPreference;
  }

  const { data, error } = await supabaseAdmin
    .from("coaches")
    .update(updateData)
    .eq("id", coachId)
    .select()
    .single();

  if (error) {
    console.error("Failed to update coach settings:", error);
    throw new Error("Failed to update coach settings");
  }

  return mapCoachRow(data);
};
