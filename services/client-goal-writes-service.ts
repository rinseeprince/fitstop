import { supabaseAdmin } from "./supabase-admin";
import { getClientTodayString } from "./today-service";
import { getReadingsOnDay } from "./measurements-service";
import { listClientGoals } from "./client-goals-service";
import { goalAsOf, goalOnDay } from "@/lib/goals/goal-timeline";
import { GOAL_TYPE_SETTINGS, goalTypeFromTargets, type GoalType } from "@/lib/goals/goal-types";
import type { Database, Json } from "@/types/database";
import type { GoalOnDay, GoalSource } from "@/types/client-goals";

/**
 * Every write of a goal (migration 193; docs/MEASUREMENT-LOG-PLAN.md §6 commit
 * 8d). The app holds SELECT on the goal tables and nothing else: each write
 * here is ONE call of a database function, which is one transaction that
 * enforces the date rules and writes nothing when nothing changed. A refusal
 * comes back as a `GoalWriteError` carrying the function's code — and, for the
 * two deadline guards, the goal in the way — which the routes turn into a
 * sentence and the fix they offer (`lib/goals/goal-write-response.ts`).
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
  "exists",
] as const;

export type GoalRefusalCode = (typeof GOAL_REFUSAL_CODES)[number];

/** The goal a deadline guard ran into: the next goal's start, or the previous goal's deadline. */
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
  if (error) throw toGoalWriteError(error);
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
  if (error) throw toGoalWriteError(error);
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
  if (error) throw toGoalWriteError(error);
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

/** A goal hard-deleted. Returns exactly what was deleted, for the undo. */
export async function deleteGoal(input: { goalId: string; clientId: string }): Promise<Json> {
  const { data, error } = await supabaseAdmin.rpc("delete_client_goal", {
    p_goal_id: input.goalId,
    p_client_id: input.clientId,
  });
  if (error) throw toGoalWriteError(error);
  return data;
}

/** A deleted goal put back exactly, from the copy its delete returned. */
export async function restoreGoal(input: { clientId: string; copy: Json }): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc("restore_client_goal", {
    p_client_id: input.clientId,
    p_copy: input.copy,
  });
  if (error) throw toGoalWriteError(error);
  return data;
}

/** The goal fields the client details sheet sends, until commit 8d2 replaces them. */
export type DetailsSheetGoalEdit = {
  goalWeight?: number;
  goalBodyFatPercentage?: number | null;
  goalDeadline?: string | null;
};

export type DetailsSheetGoalSave = {
  /** What the save did: a new goal, today's goal corrected, a deadline recorded, or nothing. */
  wrote: "create" | "edit" | "deadline" | "nothing";
  goalId: string | null;
};

/**
 * The details sheet's save, until 8d2 gives the goal its own sheet. The sheet
 * sends only the fields the coach changed; the rest are today's goal's.
 * Changing a target makes a new goal from today — or corrects today's goal
 * when it started today — typed from its targets, since the sheet has no type
 * to pick; changing only the deadline records it against today's goal.
 */
export async function saveDetailsSheetGoal(
  clientId: string,
  edit: DetailsSheetGoalEdit,
  coachId: string
): Promise<DetailsSheetGoalSave> {
  const [today, goals] = await Promise.all([
    getClientTodayString(clientId),
    listClientGoals(clientId),
  ]);
  const found = goalOnDay(goals, today);
  const current: GoalOnDay | null = found ? goalAsOf(found, today) : null;

  const targetWeight =
    edit.goalWeight !== undefined ? edit.goalWeight : current?.targetWeight ?? null;
  const targetBodyFatPercentage =
    edit.goalBodyFatPercentage !== undefined
      ? edit.goalBodyFatPercentage
      : current?.targetBodyFatPercentage ?? null;
  const deadline = edit.goalDeadline !== undefined ? edit.goalDeadline : current?.deadline ?? null;

  if (
    current &&
    targetWeight === current.targetWeight &&
    targetBodyFatPercentage === current.targetBodyFatPercentage
  ) {
    if (deadline === current.deadline) return { wrote: "nothing", goalId: current.id };
    const changed = await setGoalDeadline({
      goalId: current.id,
      clientId,
      today,
      setBy: coachId,
      deadline,
    });
    return { wrote: changed ? "deadline" : "nothing", goalId: current.id };
  }

  const readings = await getReadingsOnDay(clientId, today);
  const type = goalTypeFromTargets({
    targetWeight,
    targetBodyFatPercentage,
    reading: readings.weight?.value ?? null,
  });

  if (current && current.startsOn === today) {
    const changed = await editGoal({
      goalId: current.id,
      clientId,
      today,
      startsOn: today,
      setBy: coachId,
      type,
      name: type === current.type ? current.name : GOAL_TYPE_SETTINGS[type].name,
      targetWeight,
      targetBodyFatPercentage,
      description: current.description,
      deadline,
    });
    return { wrote: changed ? "edit" : "nothing", goalId: current.id };
  }

  const goalId = await addGoal({
    clientId,
    today,
    startsOn: today,
    source: "coach",
    setBy: coachId,
    type,
    name: GOAL_TYPE_SETTINGS[type].name,
    targetWeight,
    targetBodyFatPercentage,
    description: null,
    deadline,
  });
  return { wrote: "create", goalId };
}
