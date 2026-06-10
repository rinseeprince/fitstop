import { supabaseAdmin } from "./supabase-admin";
import { mapCoachRow } from "@/lib/mappers";
import type { Coach } from "@/types/check-in";
import type { UpdateCoachSettingsInput } from "@/lib/validations/coach";

// Update coach-controlled settings (PATCH /api/coach/settings).
// Mirrors updateClientSettings in client-service.ts.
export const updateCoachSettings = async (
  coachId: string,
  settings: UpdateCoachSettingsInput
): Promise<Coach> => {
  const { data, error } = await supabaseAdmin
    .from("coaches")
    .update({
      timezone: settings.timezone,
      updated_at: new Date().toISOString(),
    })
    .eq("id", coachId)
    .select()
    .single();

  if (error) {
    console.error("Failed to update coach settings:", error);
    throw new Error("Failed to update coach settings");
  }

  return mapCoachRow(data);
};
