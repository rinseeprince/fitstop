import { supabaseAdmin } from "./supabase-admin";
import { recomputePlanCycleInfo } from "./coach-library-helpers";

// PLAN-ATTACHED session + exercise CRUD. The standalone-session library
// (saved_plan_id NULL: create/get/duplicate/overwrite/dedup) lives in
// coach-standalone-session-service.ts.

export async function updateSavedSession(
  sessionId: string,
  coachId: string,
  updates: {
    name?: string;
    focus?: string | null;
    isRest?: boolean;
    estimatedDurationMinutes?: number | null;
    calorieSurplusPercentage?: number | null;
    notes?: string | null;
    sessionType?: string;
  }
): Promise<void> {
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from("coach_saved_sessions")
    .select("saved_plan_id")
    .eq("id", sessionId)
    .eq("coach_id", coachId)
    .single();
  if (fetchError || !existing) throw new Error(`Session not found: ${fetchError?.message}`);

  const { error } = await supabaseAdmin
    .from("coach_saved_sessions")
    .update({
      ...(updates.name !== undefined && { name: updates.name }),
      ...(updates.focus !== undefined && { focus: updates.focus }),
      ...(updates.isRest !== undefined && { is_rest: updates.isRest }),
      ...(updates.estimatedDurationMinutes !== undefined && { estimated_duration_minutes: updates.estimatedDurationMinutes }),
      ...(updates.calorieSurplusPercentage !== undefined && { calorie_surplus_percentage: updates.calorieSurplusPercentage }),
      ...(updates.notes !== undefined && { notes: updates.notes }),
      ...(updates.sessionType !== undefined && { session_type: updates.sessionType }),
    })
    .eq("id", sessionId)
    .eq("coach_id", coachId);
  if (error) throw new Error(`Failed to update session: ${error.message}`);

  // Only recompute when is_rest changed — other field edits don't affect cycle info.
  if (updates.isRest !== undefined && existing.saved_plan_id) {
    await recomputePlanCycleInfo(existing.saved_plan_id, coachId);
  }
}

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
    await recomputePlanCycleInfo(existing.saved_plan_id, coachId);
  }
}
