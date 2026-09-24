import type { ClientGoal, ClientGoalDeadline, GoalOnDay } from "@/types/client-goals";

/**
 * Which goal, and which deadline, on which day — decided ONCE, here, over a
 * client's goals (migration 193). A goal runs from its start day until the
 * next goal starts, so the goal on a day is the latest one starting on or
 * before it, and a planned goal — dated ahead — is on no day before its own.
 * A deadline is the newest of the goal's entries on or before the day; a goal
 * that has not started yet reads the one it will start with. Every surface
 * asks these with the client's today, so a planned goal takes over at the
 * client's midnight everywhere at once. Dates are YYYY-MM-DD strings, so they
 * order as text.
 */

/** The goal in force on `day`, or null before the client's first goal. */
export function goalOnDay(goals: readonly ClientGoal[], day: string): ClientGoal | null {
  let found: ClientGoal | null = null;
  for (const goal of goals) {
    if (goal.startsOn <= day && (found === null || goal.startsOn > found.startsOn)) found = goal;
  }
  return found;
}

/** The goal's deadline entry in force on `day`; a goal not started by then reads its first. */
function deadlineEntryOnDay(goal: ClientGoal, day: string): ClientGoalDeadline | null {
  const asOf = day > goal.startsOn ? day : goal.startsOn;
  let found: ClientGoalDeadline | null = null;
  for (const entry of goal.deadlines) {
    if (entry.effectiveOn <= asOf && (found === null || entry.effectiveOn > found.effectiveOn)) {
      found = entry;
    }
  }
  return found;
}

/** The goal's deadline on `day`; a goal not started by then reads its first. */
export function deadlineOnDay(goal: ClientGoal, day: string): string | null {
  return deadlineEntryOnDay(goal, day)?.deadline ?? null;
}

/**
 * The day the goal took the targets and deadline it has on `day`: its start,
 * or the last day on or before it that its deadline changed.
 */
export function goalChangedOn(goal: ClientGoal, day: string): string {
  const entry = deadlineEntryOnDay(goal, day);
  return entry && entry.effectiveOn > goal.startsOn ? entry.effectiveOn : goal.startsOn;
}

/** The goal as it stands on `day`. */
export function goalAsOf(goal: ClientGoal, day: string): GoalOnDay {
  const { deadlines: _deadlines, ...rest } = goal;
  return { ...rest, deadline: deadlineOnDay(goal, day) };
}

/** Goals dated after `today`, soonest first, each with its starting deadline. */
export function plannedGoals(goals: readonly ClientGoal[], today: string): GoalOnDay[] {
  return goals
    .filter((goal) => goal.startsOn > today)
    .sort((a, b) => (a.startsOn < b.startsOn ? -1 : 1))
    .map((goal) => goalAsOf(goal, goal.startsOn));
}
