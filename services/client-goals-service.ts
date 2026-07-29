// Uses supabaseAdmin: service-to-service calls require bypassing RLS,
// and dual-writes to clients table are system-level operations.
import { supabaseAdmin } from "./supabase-admin";
import type { ClientGoal, ClientGoalRow } from "@/types/client-goals";
import type { Database } from "@/types/database";

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
    goalBodyFatPercentage?: number | null;
    goalDeadline?: string | null;
    goalStartDate?: string | null;
    primaryGoal?: string | null;
  },
  setBy: string
): Promise<ClientGoal> => {
  // Get existing goals to carry forward unchanged fields
  const existing = await getCurrentGoals(clientId);

  // Per-field merge on DEFINED presence: a key carrying a real value wins, and an
  // explicit null still wins (it clears the column — `null !== undefined`). A key
  // that is absent OR explicitly `undefined` carries the existing value forward.
  //
  // The `!== undefined` half is load-bearing. `hasOwnProperty` alone is true for a
  // key present with value `undefined`, which is exactly what the four object-literal
  // callers build — `metrics/route.ts:218`, `client-service.ts:100` and `:269`,
  // `intake-review-service.ts:215` all spread possibly-undefined fields into a fixed
  // key set. Under presence-only they NULLed the sibling goal, and because the
  // dual-write below mirrors `merged` unconditionally, BOTH stores lost the value in
  // the same request. Plain `??` is not the fix either — it could never clear a field.
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

  // ONE transaction: supersede the active row, insert the new one, and update the
  // `clients` mirror (migration 139). Previously these were three unsynchronised
  // statements, so a failed insert after a successful supersede left the client
  // with ZERO non-superseded rows — which `getCurrentGoals` returns as null and
  // the calculator (and, since task 1.3, the coach Overview) reads as
  // *maintenance*. A silent, plausible wrong answer rather than a visible failure.
  //
  // The mirror write moved INSIDE the transaction rather than staying a
  // fire-and-forget dual-write whose error was only console.error'd. That
  // swallowed failure is how `client_goals` and the mirror came to hold different
  // goals for the same client. It now fails loudly instead of diverging silently.
  //
  // The merge stays HERE, in TypeScript, and the RPC receives an already-merged
  // complete row. That is why none of its parameters carry a SQL `DEFAULT NULL`
  // (the usual convention for optional RPC args): here NULL is a *meaningful
  // value* — it clears a goal field — so "omitted" and "null" must stay
  // distinguishable, and only the caller knows which it meant.
  //
  // NOT FIXED, deliberately: the read-modify-write race. `getCurrentGoals` above
  // still runs outside the transaction, so two concurrent writers can merge
  // against the same snapshot and the later one wins. What changed is the failure
  // mode — the loser now trips `idx_client_goals_active_unique` INSIDE the
  // transaction and rolls back cleanly, instead of leaving zero active goals.
  // Every goal field is nullable — clearing one is a legitimate edit — but
  // `supabase gen types` renders RPC parameters as non-null (Postgres has no
  // per-parameter nullability to generate from), so the generated `Args` type
  // rejects the nulls this function is required to send. The cast is scoped to
  // exactly that: the function NAME is still checked against the generated
  // `Functions` map, and the key set is still checked against this local type, so
  // a renamed or added parameter is caught. This is deliberately narrower than
  // the `as never` on the two plan RPCs, which erase the name and the whole
  // argument object and would let a signature change ship silently broken.
  type UpdateGoalsArgs = {
    p_client_id: string;
    p_set_by: string;
    p_goal_weight: number | null;
    p_goal_body_fat_percentage: number | null;
    p_goal_deadline: string | null;
    p_goal_start_date: string | null;
    p_primary_goal: string | null;
  };
  const rpcArgs: UpdateGoalsArgs = {
    p_client_id: clientId,
    p_set_by: setBy,
    p_goal_weight: merged.goal_weight,
    p_goal_body_fat_percentage: merged.goal_body_fat_percentage,
    p_goal_deadline: merged.goal_deadline,
    p_goal_start_date: merged.goal_start_date,
    p_primary_goal: merged.primary_goal,
  };

  const { data: newGoalId, error } = await supabaseAdmin.rpc(
    "update_client_goals_atomic",
    rpcArgs as unknown as Database["public"]["Functions"]["update_client_goals_atomic"]["Args"]
  );

  // Throw, never log-and-return-null. Two RPC-error conventions exist in this
  // codebase — `nutrition-plan-service.ts:135-138` logs and returns null,
  // `training-service.ts:302-304` throws — and only the throwing one preserves
  // this path's behaviour: `app/api/clients/[id]/goals/route.ts:109-115` catches
  // and returns 500, so swallowing here would turn a real failure into a 200 with
  // a broken goal.
  if (error || !newGoalId) {
    console.error("Failed to update goals:", error);
    throw new Error(
      `Failed to update goals: ${error?.message ?? "No goal id returned"}`
    );
  }

  const { data, error: readError } = await supabaseAdmin
    .from("client_goals")
    .select("*")
    .eq("id", newGoalId)
    .single();

  if (readError) {
    console.error("Failed to read back new goals:", readError);
    throw new Error(`Failed to read back new goals: ${readError.message}`);
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
