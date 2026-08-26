import { supabaseAdmin } from "./supabase-admin";
import { recomputePlanFrequency } from "./coach-library-helpers";

// PLAN-ATTACHED session + exercise CRUD. The standalone-session library
// (saved_plan_id NULL: create/get/duplicate/overwrite/dedup) lives in
// coach-standalone-session-service.ts.

export async function removeSavedSession(sessionId: string, coachId: string): Promise<void> {
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from("coach_saved_sessions")
    .select("saved_plan_id")
    .eq("id", sessionId)
    .eq("coach_id", coachId)
    .single();
  if (fetchError || !existing) throw new Error(`Session not found: ${fetchError?.message}`);

  const { error } = await supabaseAdmin
    .from("coach_saved_sessions")
    .delete()
    .eq("id", sessionId)
    .eq("coach_id", coachId);
  if (error) throw new Error(`Failed to delete session: ${error.message}`);

  if (existing.saved_plan_id) {
    await recomputePlanFrequency(existing.saved_plan_id, coachId);
  }
}
