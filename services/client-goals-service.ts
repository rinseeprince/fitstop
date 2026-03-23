// Uses supabaseAdmin: service-to-service calls require bypassing RLS,
// and dual-writes to clients table are system-level operations.
import { supabaseAdmin } from "./supabase-admin";
import type { ClientGoal, ClientGoalRow } from "@/types/roadmap";

function mapClientGoalRow(row: ClientGoalRow): ClientGoal {
  return {
    id: row.id,
    clientId: row.client_id,
    goalWeight: row.goal_weight ?? undefined,
    goalBodyFatPercentage: row.goal_body_fat_percentage ?? undefined,
    goalDeadline: row.goal_deadline ?? undefined,
    primaryGoal: row.primary_goal ?? undefined,
    setBy: row.set_by,
    notes: row.notes ?? undefined,
    effectiveFrom: row.effective_from,
    supersededAt: row.superseded_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const getCurrentGoals = async (
  clientId: string
): Promise<ClientGoal | null> => {
  const { data, error } = await supabaseAdmin
    .from("client_goals")
    .select("*")
    .eq("client_id", clientId)
    .is("superseded_at", null)
    .maybeSingle();

  if (error) {
    console.error("Failed to fetch current goals:", error);
    throw new Error(`Failed to fetch current goals: ${error.message}`);
  }

  return data ? mapClientGoalRow(data) : null;
};

export const updateGoals = async (
  clientId: string,
  goals: {
    goalWeight?: number;
    goalBodyFatPercentage?: number;
    goalDeadline?: string;
    primaryGoal?: string;
  },
  setBy: string
): Promise<ClientGoal> => {
  const now = new Date().toISOString();

  // Get existing goals to carry forward unchanged fields
  const existing = await getCurrentGoals(clientId);

  // Supersede existing row if present
  if (existing) {
    const { error: supersedeError } = await supabaseAdmin
      .from("client_goals")
      .update({ superseded_at: now, updated_at: now })
      .eq("client_id", clientId)
      .is("superseded_at", null);

    if (supersedeError) {
      console.error("Failed to supersede goals:", supersedeError);
      throw new Error(
        `Failed to supersede goals: ${supersedeError.message}`
      );
    }
  }

  // Merge: new values override, unchanged fields carry forward
  const merged = {
    goal_weight: goals.goalWeight ?? existing?.goalWeight ?? null,
    goal_body_fat_percentage:
      goals.goalBodyFatPercentage ??
      existing?.goalBodyFatPercentage ??
      null,
    goal_deadline: goals.goalDeadline ?? existing?.goalDeadline ?? null,
    primary_goal: goals.primaryGoal ?? existing?.primaryGoal ?? null,
  };

  const { data, error } = await supabaseAdmin
    .from("client_goals")
    .insert({
      client_id: clientId,
      ...merged,
      set_by: setBy,
      effective_from: now,
    })
    .select()
    .single();

  if (error) {
    console.error("Failed to insert new goals:", error);
    throw new Error(`Failed to insert new goals: ${error.message}`);
  }

  // Dual-write to clients table for backward compatibility
  const { error: clientError } = await supabaseAdmin
    .from("clients")
    .update({
      goal_weight: merged.goal_weight,
      goal_body_fat_percentage: merged.goal_body_fat_percentage,
      goal_deadline: merged.goal_deadline,
      updated_at: now,
    })
    .eq("id", clientId);

  if (clientError) {
    console.error("Failed to dual-write goals to clients:", clientError);
  }

  return mapClientGoalRow(data);
};

export const getGoalsHistory = async (
  clientId: string
): Promise<ClientGoal[]> => {
  const { data, error } = await supabaseAdmin
    .from("client_goals")
    .select("*")
    .eq("client_id", clientId)
    .order("effective_from", { ascending: false });

  if (error) {
    console.error("Failed to fetch goals history:", error);
    throw new Error(`Failed to fetch goals history: ${error.message}`);
  }

  return (data || []).map((row: ClientGoalRow) => mapClientGoalRow(row));
};
