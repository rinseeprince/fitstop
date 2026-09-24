import { deadlineOnDay, goalChangedOn, goalOnDay } from "@/lib/goals/goal-timeline";
import { resolveEffectiveGoal } from "@/lib/goals/resolve-effective-goal";
import { detectGoalDrift } from "@/lib/goals/detect-goal-drift";
import type { ClientGoal } from "@/types/client-goals";

/**
 * When a nutrition version is out of date (docs/MEASUREMENT-LOG-PLAN.md §6
 * commit 8d1): from the first day, today onward, whose goal differs from the
 * goal it was built for. "Differs" means the calories would come out
 * different — a version records the weight target and the deadline it was
 * priced for (`goal_weight_kg`, `goal_deadline`), so a new goal with the same
 * two does not make it out of date. Days before today are history and never
 * judged; a queued version is judged from its own start. The earliest day
 * across the versions is the one reported. Calories the coach typed are judged
 * the same way — they were saved under a goal all the same — and the answer
 * says so, for the notice to word (commit 8d4).
 *
 * PURE: the caller reads the versions and the goals and hands in the client's
 * today. Nothing regenerates here or anywhere — the coach decides.
 */

/** The goal a version was priced for, or the one in force on a day: the weight
 *  target (kg; null = maintenance) and the deadline. */
export type GoalPricing = {
  goalWeightKg: number | null;
  deadline: string | null;
};

/** A version as the rule reads it: its window and the goal it was built for. */
export type NutritionVersionGoal = {
  id: string;
  effectiveFrom: string;
  effectiveUntil: string;
  built: GoalPricing;
  /** Goals the coach kept these calories for by closing the notice
   *  (migration 197): a day whose goal prices like one of them fits too. */
  kept: GoalPricing[];
  /** Calories the coach typed (`custom_macros_enabled`), which the goal they
   *  were saved under never priced. */
  setByHand: boolean;
};

export type NutritionOutOfDate = {
  versionId: string;
  /** The first day, today or later, whose goal differs from the one it was built for. */
  fromDay: string;
  built: GoalPricing;
  /** The goal in force on `fromDay`. */
  goal: GoalPricing;
  /** That goal's name, which the notice says; null when no goal is in force. */
  goalName: string | null;
  /** The day that goal took the shape it has on `fromDay` — its start, or its
   *  latest deadline change — when that falls on or after the version's first
   *  day, and so after its calories were saved; null when the change carries
   *  no day (a goal deleted, or edited before its start) or no goal is in force. */
  goalChangedOn: string | null;
  setByHand: boolean;
};

/** The weight target and deadline in force on `day`; no goal is maintenance. */
/**
 * Whether two pricings give different calories. The calculator holds a plan at
 * maintenance unless it has both a goal weight and a deadline, so two pricings
 * that each lack one are the same calories, whatever else they hold.
 */
function pricesDiffer(built: GoalPricing, goal: GoalPricing): boolean {
  const atMaintenance = (pricing: GoalPricing) =>
    pricing.goalWeightKg == null || pricing.deadline == null;
  if (atMaintenance(built) && atMaintenance(goal)) return false;
  return detectGoalDrift(built, goal).changed;
}

function pricingOnDay(goals: readonly ClientGoal[], day: string): GoalPricing {
  const goal = goalOnDay(goals, day);
  const effective = resolveEffectiveGoal(
    goal
      ? {
          targetWeight: goal.targetWeight,
          targetBodyFatPercentage: goal.targetBodyFatPercentage,
          deadline: deadlineOnDay(goal, day),
        }
      : null
  );
  return { goalWeightKg: effective.goalWeightKg, deadline: effective.deadline };
}

/**
 * The days in [from, until] on which the pricing can change: `from` itself,
 * then every goal start inside the range. Between two of these days the goal
 * in force and its deadline are the same, so judging each one judges every
 * day. A deadline entry is never a day of its own: a running goal's change is
 * dated the client's today (`set_client_goal_deadline`), which `from` already
 * reads, and a planned goal's only entry is dated its start (migration 193).
 */
function turningDays(goals: readonly ClientGoal[], from: string, until: string): string[] {
  const days = new Set<string>([from]);
  for (const goal of goals) {
    if (goal.startsOn > from && goal.startsOn <= until) days.add(goal.startsOn);
  }
  return [...days].sort();
}

export function findNutritionOutOfDate(
  versions: readonly NutritionVersionGoal[],
  goals: readonly ClientGoal[],
  today: string
): NutritionOutOfDate | null {
  let earliest: NutritionOutOfDate | null = null;
  for (const version of versions) {
    if (version.effectiveUntil < today) continue;
    const from = version.effectiveFrom > today ? version.effectiveFrom : today;
    for (const day of turningDays(goals, from, version.effectiveUntil)) {
      const goal = pricingOnDay(goals, day);
      if (!pricesDiffer(version.built, goal)) continue;
      // Closed by the coach for this goal: kept, so it stays closed until the
      // goal on a day prices differently again.
      if (version.kept.some((keptFor) => !pricesDiffer(keptFor, goal))) continue;
      if (earliest === null || day < earliest.fromDay) {
        const inForce = goalOnDay(goals, day);
        // A version never starts before the day it is saved, so a goal shaped
        // on or after its first day changed after the calories were saved.
        // Shaped before it, the goal differs through an edit or a delete,
        // which carry no day: the change is left undated rather than dated
        // to a day the calories already knew.
        const shapedOn = inForce ? goalChangedOn(inForce, day) : null;
        earliest = {
          versionId: version.id,
          fromDay: day,
          built: version.built,
          goal,
          goalName: inForce?.name ?? null,
          goalChangedOn: shapedOn !== null && shapedOn >= version.effectiveFrom ? shapedOn : null,
          setByHand: version.setByHand,
        };
      }
      break;
    }
  }
  return earliest;
}
