import { supabaseAdmin } from "./supabase-admin";
import type { GoalType } from "@/lib/goals/goal-types";
import type { Database } from "@/types/database";
import type { GoalSource } from "@/types/client-goals";

/**
 * Every write of a goal (migration 193; docs/MEASUREMENT-LOG-PLAN.md §6 commit
 * 8d). The app holds SELECT on the goal tables and nothing else: each write
 * here is ONE call of a database function, which is one transaction that
 * enforces the date rules and writes nothing when nothing changed. A refusal
 * comes back as a `GoalWriteError` carrying the function's code — and, for the
 * two deadline guards, the goal in the way — which the routes turn into a
 * sentence (`lib/goals/goal-write-response.ts`).
 */

type Functions = Database["public"]["Functions"];

export const GOAL_REFUSAL_CODES = [
  "invalid_args",
  "not_found",
  "starts_in_past",
  "day_taken",
  "deadline_before_start",
  "deadline_after_next",
  "previous_deadline",
  "started",
  "ended",
] as const;

export type GoalRefusalCode = (typeof GOAL_REFUSAL_CODES)[number];

/**
 * The goal a deadline guard ran into. `deadline_after_next`: the next goal,
 * with its start and — added here, absent when it has none — its own
 * deadline, which says whether it can move past the new one.
 * `previous_deadline`: the previous goal, with its deadline.
 */
export type GoalConflict = {
  goalId: string;
  name: string;
  startsOn?: string;
  deadline?: string;
};

export class GoalWriteError extends Error {
  constructor(
    readonly code: GoalRefusalCode,
    message: string,
    readonly conflict: GoalConflict | null = null
  ) {
    super(message);
    this.name = "GoalWriteError";
  }
}

function isRefusalCode(value: string): value is GoalRefusalCode {
  return (GOAL_REFUSAL_CODES as readonly string[]).includes(value);
}

/** A function's "code: message" refusal as a typed error; anything else stays an Error. */
export function toGoalWriteError(error: { message: string }): Error {
  const match = /^([a-z_]+):\s*([\s\S]*)$/.exec(error.message);
  if (!match || !isRefusalCode(match[1])) {
    return new Error(`Goal write failed: ${error.message}`);
  }
  const [, code, detail] = match;
  if (code === "deadline_after_next" || code === "previous_deadline") {
    try {
      const parsed = JSON.parse(detail) as {
        goalId: string;
        name: string;
        startsOn?: string | null;
        deadline?: string | null;
      };
      return new GoalWriteError(code, detail, {
        goalId: parsed.goalId,
        name: parsed.name,
        startsOn: parsed.startsOn ?? undefined,
        deadline: parsed.deadline ?? undefined,
      });
    } catch {
      return new Error(`Goal write failed: ${error.message}`);
    }
  }
  return new GoalWriteError(code, detail);
}

/**
 * A `deadline_after_next` refusal with the next goal's own deadline added —
 * the function names the goal in the way and its start, and the refusal
 * suggests moving it past the new deadline only where its deadline allows. The next goal is
 * always a planned one, whose one deadline entry is dated its start; read
 * scoped to the client. Any other error passes through.
 */
async function withNextGoalDeadline(error: Error, clientId: string): Promise<Error> {
  if (!(error instanceof GoalWriteError) || error.code !== "deadline_after_next" || !error.conflict) {
    return error;
  }
  const { data, error: readError } = await supabaseAdmin
    .from("client_goals")
    .select("client_goal_deadlines(effective_on, deadline)")
    .eq("id", error.conflict.goalId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (readError) return new Error(`Goal write failed: ${readError.message}`);
  const latest = [...(data?.client_goal_deadlines ?? [])].sort((a, b) =>
    a.effective_on < b.effective_on ? 1 : -1
  )[0];
  return new GoalWriteError(error.code, error.message, {
    ...error.conflict,
    deadline: latest?.deadline ?? undefined,
  });
}

/** What a goal is: its type, name, targets, description and deadline. */
export type GoalFields = {
  type: GoalType;
  name: string;
  targetWeight: number | null;
  targetBodyFatPercentage: number | null;
  description: string | null;
  deadline: string | null;
};

/**
 * A goal from a day: `today` sets it now, a later day plans it. The optional
 * parameters are omitted when empty — each defaults to NULL in SQL.
 */
export async function addGoal(
  input: GoalFields & {
    clientId: string;
    today: string;
    startsOn: string;
    source: GoalSource;
    setBy: string;
  }
): Promise<string> {
  const args: Functions["add_client_goal"]["Args"] = {
    p_client_id: input.clientId,
    p_today: input.today,
    p_starts_on: input.startsOn,
    p_type: input.type,
    p_name: input.name,
    p_source: input.source,
    p_set_by: input.setBy,
  };
  if (input.targetWeight != null) args.p_target_weight = input.targetWeight;
  if (input.targetBodyFatPercentage != null) args.p_target_body_fat_percentage = input.targetBodyFatPercentage;
  if (input.description != null) args.p_description = input.description;
  if (input.deadline != null) args.p_deadline = input.deadline;

  const { data, error } = await supabaseAdmin.rpc("add_client_goal", args);
  if (error) throw await withNextGoalDeadline(toGoalWriteError(error), input.clientId);
  return data;
}

/** A planned goal, or today's, rewritten whole. Returns whether anything changed. */
export async function editGoal(
  input: GoalFields & {
    goalId: string;
    clientId: string;
    today: string;
    startsOn: string;
    setBy: string;
  }
): Promise<boolean> {
  const args: Functions["edit_client_goal"]["Args"] = {
    p_goal_id: input.goalId,
    p_client_id: input.clientId,
    p_today: input.today,
    p_type: input.type,
    p_name: input.name,
    p_starts_on: input.startsOn,
    p_set_by: input.setBy,
  };
  if (input.targetWeight != null) args.p_target_weight = input.targetWeight;
  if (input.targetBodyFatPercentage != null) args.p_target_body_fat_percentage = input.targetBodyFatPercentage;
  if (input.description != null) args.p_description = input.description;
  if (input.deadline != null) args.p_deadline = input.deadline;

  const { data, error } = await supabaseAdmin.rpc("edit_client_goal", args);
  if (error) throw await withNextGoalDeadline(toGoalWriteError(error), input.clientId);
  return data;
}

/** A goal's deadline changed, keeping the goal. Returns whether anything changed. */
export async function setGoalDeadline(input: {
  goalId: string;
  clientId: string;
  today: string;
  setBy: string;
  deadline: string | null;
}): Promise<boolean> {
  const args: Functions["set_client_goal_deadline"]["Args"] = {
    p_goal_id: input.goalId,
    p_client_id: input.clientId,
    p_today: input.today,
    p_set_by: input.setBy,
  };
  if (input.deadline != null) args.p_deadline = input.deadline;

  const { data, error } = await supabaseAdmin.rpc("set_client_goal_deadline", args);
  if (error) throw await withNextGoalDeadline(toGoalWriteError(error), input.clientId);
  return data;
}

/** A goal's labels — its name and description. Returns whether anything changed. */
export async function renameGoal(input: {
  goalId: string;
  clientId: string;
  name: string;
  description: string | null;
}): Promise<boolean> {
  const args: Functions["rename_client_goal"]["Args"] = {
    p_goal_id: input.goalId,
    p_client_id: input.clientId,
    p_name: input.name,
  };
  if (input.description != null) args.p_description = input.description;

  const { data, error } = await supabaseAdmin.rpc("rename_client_goal", args);
  if (error) throw toGoalWriteError(error);
  return data;
}

/** A goal hard-deleted, with its deadlines. */
export async function deleteGoal(input: { goalId: string; clientId: string }): Promise<void> {
  const { error } = await supabaseAdmin.rpc("delete_client_goal", {
    p_goal_id: input.goalId,
    p_client_id: input.clientId,
  });
  if (error) throw toGoalWriteError(error);
}
