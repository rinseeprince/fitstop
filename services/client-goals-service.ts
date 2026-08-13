// Uses supabaseAdmin: service-to-service calls require bypassing RLS,
// and dual-writes to clients table are system-level operations.
import { supabaseAdmin } from "./supabase-admin";
import { GOAL_HISTORY_LIMIT } from "@/lib/constants";
import type { ClientGoal, ClientGoalRow } from "@/types/client-goals";

function mapClientGoalRow(row: ClientGoalRow): ClientGoal {
  return {
    id: row.id,
    clientId: row.client_id,
    goalWeight: row.goal_weight ?? undefined,
    goalBodyFatPercentage: row.goal_body_fat_percentage ?? undefined,
    goalDeadline: row.goal_deadline ?? undefined,
    goalStartDate: row.goal_start_date ?? undefined,
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
  // Ordering belt. `idx_client_goals_active_unique` (migration 060) makes two
  // active rows impossible, so this changes nothing today. It matters if that
  // index is ever lost: two active rows make `maybeSingle()` throw PGRST116
  // forever, and because `updateGoals` opens with this very call, the set-based
  // supersede that would heal the duplicate is unreachable — there is no in-app
  // recovery, a human runs SQL. Ordering turns a permanent wedge into a
  // recoverable wrong answer.
  //
  // Its hole: `effective_from` is stamped from one app-side timestamp (see
  // `updateGoals` below), so two racing writers tie and the pick is arbitrary.
  // This is insurance against a lost index, NOT a fix for the write race.
  const { data, error } = await supabaseAdmin
    .from("client_goals")
    .select("*")
    .eq("client_id", clientId)
    .is("superseded_at", null)
    .order("effective_from", { ascending: false })
    .limit(1)
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
    goalBodyFatPercentage?: number | null;
    goalDeadline?: string | null;
    goalStartDate?: string | null;
    primaryGoal?: string | null;
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

  // Per-field merge on DEFINED presence: a key carrying a real value wins, and an
  // explicit null still wins (it clears the column — `null !== undefined`). A key
  // that is absent OR explicitly `undefined` carries the existing value forward.
  //
  // The `!== undefined` half is load-bearing. `hasOwnProperty` alone is true for a
  // key present with value `undefined`, which is exactly what the object-literal
  // callers build: the intake metrics sync, `updateClient` and the metrics PUT each
  // spread possibly-undefined fields into a fixed key set, so a single-field goal
  // edit reached here with its sibling present-and-undefined and NULLed it. Because
  // the dual-write below mirrors `merged` unconditionally, BOTH stores lost the
  // value in the same request — there was no surviving copy to reconcile from.
  //
  // `createClient` builds the same shape but could never clobber: it runs straight
  // after the client INSERT, so there is no existing row and both branches already
  // yielded null. THREE clobber sites, not four — do not "correct" that upward.
  //
  // Plain `??` is not the fix either — it could never clear a field. `goalWeight`
  // is the one field no caller can clear: it is `number | undefined` here and
  // `.optional()` but not `.nullable()` in `updateGoalsSchema`.
  const has = (key: keyof typeof goals) =>
    Object.prototype.hasOwnProperty.call(goals, key) && goals[key] !== undefined;
  const merged = {
    goal_weight: has("goalWeight")
      ? goals.goalWeight ?? null
      : existing?.goalWeight ?? null,
    goal_body_fat_percentage: has("goalBodyFatPercentage")
      ? goals.goalBodyFatPercentage ?? null
      : existing?.goalBodyFatPercentage ?? null,
    goal_deadline: has("goalDeadline")
      ? goals.goalDeadline ?? null
      : existing?.goalDeadline ?? null,
    goal_start_date: has("goalStartDate")
      ? goals.goalStartDate ?? null
      : existing?.goalStartDate ?? null,
    primary_goal: has("primaryGoal")
      ? goals.primaryGoal ?? null
      : existing?.primaryGoal ?? null,
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

/**
 * The client's SUPERSEDED goal versions, newest first — what the goal used to be.
 *
 * Two things changed when the unreachable `?history=true` branch was replaced by
 * a sibling route (Task 0b.6), and both were defects rather than preferences:
 *
 * - **`superseded_at IS NOT NULL`.** There was no filter, so the CURRENT goal
 *   came back inside "history" as well — once as the live goal and once as its
 *   own predecessor. The live goal is rendered above this list from its own read.
 * - **A bounded result.** There was no limit, so a heavily-edited client returned
 *   every version ever written.
 */
export const getGoalsHistory = async (
  clientId: string,
  options: { limit?: number } = {}
): Promise<ClientGoal[]> => {
  const { data, error } = await supabaseAdmin
    .from("client_goals")
    .select("*")
    .eq("client_id", clientId)
    .not("superseded_at", "is", null)
    .order("effective_from", { ascending: false })
    .limit(options.limit ?? GOAL_HISTORY_LIMIT);

  if (error) {
    console.error("Failed to fetch goals history:", error);
    throw new Error(`Failed to fetch goals history: ${error.message}`);
  }

  return (data || []).map((row: ClientGoalRow) => mapClientGoalRow(row));
};
