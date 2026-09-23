import { supabaseAdmin } from "./supabase-admin";
import { getClientTodayString } from "./today-service";
import { getReadingsOnDay } from "./measurements-service";
import { getTrainingPlansOverlapping } from "./training-service";
import { addDaysToDateString } from "@/lib/date-helpers";
import { goalHistoryRows, type NutritionVersionWindow } from "@/lib/goals/goal-history";
import { goalAsOf, goalOnDay, plannedGoals } from "@/lib/goals/goal-timeline";
import { isGoalType } from "@/lib/goals/goal-types";
import { versionCalories } from "@/lib/nutrition/version-calories";
import type { Database } from "@/types/database";
import type {
  ClientGoal,
  ClientGoalsOverview,
  GoalHistoryRow,
  GoalOnDay,
  GoalSource,
} from "@/types/client-goals";

/**
 * A client's goals, read (migration 193; docs/MEASUREMENT-LOG-PLAN.md §6
 * commit 8d). One read of the goal rows with their deadline lists; WHICH goal
 * and which deadline a day has is decided by the pure selectors in
 * `lib/goals/goal-timeline.ts`, and "today" is the client's, from
 * `getClientTodayString` — so a planned goal takes over at the client's
 * midnight on every surface at once. The app reads these tables and never
 * writes them: every write is one of the goal functions, driven by
 * `services/client-goal-writes-service.ts`.
 */

type GoalRow = Database["public"]["Tables"]["client_goals"]["Row"];
type DeadlineRow = Database["public"]["Tables"]["client_goal_deadlines"]["Row"];
type GoalRowWithDeadlines = GoalRow & {
  client_goal_deadlines: Pick<DeadlineRow, "effective_on" | "deadline" | "set_by">[] | null;
};

const GOAL_SELECT = "*, client_goal_deadlines(effective_on, deadline, set_by)";

function mapGoalRow(row: GoalRowWithDeadlines): ClientGoal {
  if (!isGoalType(row.type)) {
    throw new Error(`Goal ${row.id} has an unknown type: ${row.type}`);
  }
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    type: row.type,
    targetWeight: row.target_weight == null ? null : Number(row.target_weight),
    targetBodyFatPercentage:
      row.target_body_fat_percentage == null ? null : Number(row.target_body_fat_percentage),
    description: row.description,
    startsOn: row.starts_on,
    source: row.source as GoalSource,
    setBy: row.set_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deadlines: (row.client_goal_deadlines ?? [])
      .map((entry) => ({
        effectiveOn: entry.effective_on,
        deadline: entry.deadline,
        setBy: entry.set_by,
      }))
      .sort((a, b) => (a.effectiveOn < b.effectiveOn ? -1 : 1)),
  };
}

/**
 * Every goal the client has — past, current and planned — with every deadline
 * each has had, oldest first. A client's goals are a coaching record, tens of
 * rows over years, so one unpaged read is the whole of it.
 */
export async function listClientGoals(clientId: string): Promise<ClientGoal[]> {
  const { data, error } = await supabaseAdmin
    .from("client_goals")
    .select(GOAL_SELECT)
    .eq("client_id", clientId)
    .order("starts_on", { ascending: true });

  if (error) {
    console.error("Failed to read goals:", error);
    throw new Error(`Failed to read goals: ${error.message}`);
  }
  return (data ?? []).map((row) => mapGoalRow(row as GoalRowWithDeadlines));
}

/** The goal in force on `day` (the client's calendar), with that day's deadline. */
export async function getGoalForDate(clientId: string, day: string): Promise<GoalOnDay | null> {
  const goal = goalOnDay(await listClientGoals(clientId), day);
  return goal ? goalAsOf(goal, day) : null;
}

/** The goal in force on the client's today. */
export async function getCurrentGoal(clientId: string): Promise<GoalOnDay | null> {
  const [today, goals] = await Promise.all([
    getClientTodayString(clientId),
    listClientGoals(clientId),
  ]);
  const goal = goalOnDay(goals, today);
  return goal ? goalAsOf(goal, today) : null;
}

/**
 * The coach's goal read: today's goal — with the client's readings on its
 * start day, which its progress runs from — the goals planned after it, and
 * the client's today.
 */
export async function getGoalsOverview(clientId: string): Promise<ClientGoalsOverview> {
  const [today, goals] = await Promise.all([
    getClientTodayString(clientId),
    listClientGoals(clientId),
  ]);
  const goal = goalOnDay(goals, today);
  const planned = plannedGoals(goals, today);
  if (!goal) return { current: null, planned, clientToday: today };

  const readings = await getReadingsOnDay(clientId, goal.startsOn);
  return {
    current: {
      ...goalAsOf(goal, today),
      startReadings: {
        weight: readings.weight?.value ?? null,
        bodyFat: readings.bodyFat?.value ?? null,
      },
    },
    planned,
    clientToday: today,
  };
}

/**
 * The active nutrition versions with a day on or after `from`, earliest first:
 * each one's window, its calories and the goal it was built for.
 */
async function getNutritionVersionsFrom(clientId: string, from: string): Promise<NutritionVersionWindow[]> {
  const { data, error } = await supabaseAdmin
    .from("nutrition_plans")
    .select(
      "effective_from, effective_until, baseline_calories, custom_macros_enabled, custom_calories, goal_weight_kg, goal_deadline"
    )
    .eq("client_id", clientId)
    .eq("status", "active")
    .gte("effective_until", from)
    .order("effective_from", { ascending: true });

  if (error) {
    console.error("Failed to read the nutrition versions:", error);
    throw new Error(`Failed to read the nutrition versions: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    startsOn: row.effective_from,
    endsOn: row.effective_until,
    calories: versionCalories({
      baselineCalories: row.baseline_calories,
      customMacrosEnabled: row.custom_macros_enabled,
      customCalories: row.custom_calories,
    }),
    builtFor: {
      goalWeightKg: row.goal_weight_kg == null ? null : Number(row.goal_weight_kg),
      deadline: row.goal_deadline,
    },
  }));
}

/**
 * The Journey's goals table: every goal, planned first, each with what
 * happened during it (`goalHistoryRows`), judged against the client's today.
 * The programs are read from the day before the first goal, so a program
 * starting on its first day can be seen to replace the one before it.
 */
export async function getGoalHistory(clientId: string): Promise<GoalHistoryRow[]> {
  const [today, goals] = await Promise.all([
    getClientTodayString(clientId),
    listClientGoals(clientId),
  ]);
  if (goals.length === 0) return [];

  const firstDay = goals[0].startsOn;
  const [plans, versions] = await Promise.all([
    getTrainingPlansOverlapping(clientId, addDaysToDateString(firstDay, -1), null),
    getNutritionVersionsFrom(clientId, firstDay),
  ]);
  const programs = plans.map((plan) => ({
    name: plan.name,
    startsOn: plan.effectiveFrom,
    endsOn: plan.effectiveUntil,
  }));
  return goalHistoryRows({ goals, today, programs, versions });
}
