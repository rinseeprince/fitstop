import { getCheckInById, getPreviousCheckIn } from "./check-in-service";
import { getClientById } from "./client-service";
import { calculateMetricChange, calculateDaysBetween } from "@/utils/comparison-utils";
import { listClientGoals } from "./client-goals-service";
import { getClientTodayString } from "./today-service";
import { goalOnDay } from "@/lib/goals/goal-timeline";
import { withoutSentSnapshot } from "@/lib/mappers";
import type {
  CheckIn,
  CheckInComparison,
  Client,
  GetCheckInComparisonResponse,
  GoalProgress,
} from "@/types/check-in";

/**
 * The comparison behind a check-in's review. Its goal section is the one the
 * check-in saved when it was sent (lib/check-in/sent-snapshot.ts): the goal in
 * force on its day, where the client stood, the verdict, the pace and the days
 * to the deadline, and the nutrition plan the drift note compares with — so a
 * goal changed or a reading corrected since never moves a sent check-in (owner
 * ruling 2026-09-22). One thing is read live, because it is about today:
 * whether the goal judged is still the client's goal, which is what "Set new
 * goals" asks. The changes since the last check-in compare what the two
 * check-ins reported, each from its own saved copy.
 */
export const getCheckInComparison = async (
  checkInId: string
): Promise<GetCheckInComparisonResponse> => {
  const currentCheckIn = await getCheckInById(checkInId);
  if (!currentCheckIn) {
    throw new Error("Check-in not found");
  }

  const client = await getClientById(currentCheckIn.clientId);
  if (!client) {
    throw new Error("Client not found");
  }

  return buildCheckInComparison(currentCheckIn, client);
};

/**
 * The same comparison for a check-in and its client already in hand — the AI
 * review's input builder holds both and reads nothing twice.
 */
export const buildCheckInComparison = async (
  currentCheckIn: CheckIn,
  client: Client
): Promise<GetCheckInComparisonResponse> => {
  const snapshot = currentCheckIn.sentSnapshot;
  if (!snapshot) {
    // Only a row a seed script inserted and the fill has not reached; its goal
    // section would otherwise be invented from today, which is the one thing a
    // sent check-in must never show.
    throw new Error(`Check-in ${currentCheckIn.id} has no saved copy`);
  }

  const [previousCheckIn, goals, today] = await Promise.all([
    getPreviousCheckIn(currentCheckIn.clientId, currentCheckIn.id),
    listClientGoals(currentCheckIn.clientId),
    getClientTodayString(currentCheckIn.clientId),
  ]);

  // Still the goal in force on the client's today, or one since replaced? The
  // strip offers "Set new goals" only for the goal in force.
  const goalIsCurrent =
    snapshot.goal != null && snapshot.goal.id === goalOnDay(goals, today)?.id;
  const goalProgress: GoalProgress = {
    ...snapshot.goalProgress,
    // The goal judged, by name, type and start day: all a goal with no target
    // has to show, and where its countdown to the deadline runs from.
    goal: snapshot.goal
      ? { name: snapshot.goal.name, type: snapshot.goal.type, startsOn: snapshot.goal.startsOn }
      : null,
    goalIsCurrent,
  };

  const timeBetweenCheckIns = previousCheckIn
    ? calculateDaysBetween(currentCheckIn.createdAt, previousCheckIn.createdAt)
    : undefined;

  // Build comparison data
  const comparison: CheckInComparison = {
    // Its own saved copy stays on the server; the browser gets the check-in.
    previous: previousCheckIn ? withoutSentSnapshot(previousCheckIn) : null,
    client: {
      id: client.id,
      name: client.name,
      // The readings then, so the drift note compares like with like.
      currentWeight: snapshot.standing.weight ?? undefined,
      currentBodyFatPercentage: snapshot.standing.bodyFat ?? undefined,
      unitPreference: client.unitPreference,
      // The version that covered the check-in's day: its base weight, and its
      // effective_from — when the numbers the drift note compares against
      // took effect.
      nutritionPlanBaseWeightKg: snapshot.nutritionPlan?.baseWeightKg ?? undefined,
      nutritionPlanEffectiveDate: snapshot.nutritionPlan?.effectiveFrom ?? undefined,
    },
    changes: {
      weight: calculateMetricChange(
        currentCheckIn.weight,
        previousCheckIn?.weight
      ),
      bodyFatPercentage: calculateMetricChange(
        currentCheckIn.bodyFatPercentage,
        previousCheckIn?.bodyFatPercentage
      ),
      mood: calculateMetricChange(
        currentCheckIn.mood,
        previousCheckIn?.mood
      ),
      energy: calculateMetricChange(
        currentCheckIn.energy,
        previousCheckIn?.energy
      ),
      sleep: calculateMetricChange(
        currentCheckIn.sleep,
        previousCheckIn?.sleep
      ),
      stress: calculateMetricChange(
        currentCheckIn.stress,
        previousCheckIn?.stress
      ),
      soreness: calculateMetricChange(
        currentCheckIn.soreness,
        previousCheckIn?.soreness
      ),
    },
    timeBetweenCheckIns,
  };

  return {
    comparison,
    goalProgress,
  };
};
