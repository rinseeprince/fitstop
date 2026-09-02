import { getCheckInById, getPreviousCheckIn, getClientCheckIns } from "./check-in-service";
import { getClientById } from "./client-service";
import { getNutritionPlanForDate } from "./nutrition-plan-service";
import { calculateMetricChange, calculateDaysBetween } from "@/utils/comparison-utils";
import { getCurrentGoals } from "./client-goals-service";
import {
  resolveEffectiveGoal,
  toClientGoalInput,
} from "@/lib/goals/resolve-effective-goal";
import { deriveGoalProgress } from "@/lib/goals/goal-progress";
import { getTodayDateStringInTimezone, getTodayInTimezone, differenceInDays } from "@/lib/date-helpers";
import type {
  CheckInComparison,
  GetCheckInComparisonResponse,
} from "@/types/check-in";

export const getCheckInComparison = async (
  checkInId: string
): Promise<GetCheckInComparisonResponse> => {
  // Fetch current check-in
  const currentCheckIn = await getCheckInById(checkInId);
  if (!currentCheckIn) {
    throw new Error("Check-in not found");
  }

  // Fetch client info
  const client = await getClientById(currentCheckIn.clientId);
  if (!client) {
    throw new Error("Client not found");
  }

  // Fetch previous check-in
  const previousCheckIn = await getPreviousCheckIn(
    currentCheckIn.clientId,
    checkInId
  );

  // Fetch the recent check-ins (last 10, for the trend), the nutrition version
  // COVERING the client's today (migration 144 — the drift banner must compare
  // against the era actually governing them, and date its "since" from when
  // those numbers took effect, not from when the first-ever plan row was born),
  // and current goals from client_goals.
  const clientLocalToday = getTodayDateStringInTimezone(client.timezone);
  const [{ checkIns }, activePlan, currentGoals] = await Promise.all([
    getClientCheckIns(currentCheckIn.clientId, { limit: 10 }),
    getNutritionPlanForDate(currentCheckIn.clientId, clientLocalToday).catch((err) => {
      // Degrade to "no plan" for the banner rather than failing the whole
      // comparison read — but never silently.
      console.error("Comparison covering-plan lookup failed:", err);
      return null;
    }),
    getCurrentGoals(currentCheckIn.clientId),
  ]);

  // Single-scope effective goal (Session 7.8): the live client goal. Weight AND
  // deadline come from ONE scope — fixing the cross-scope "Deadline unrealistic"
  // false alarm (the old code paired the client-scope goal weight with the active
  // nutrition plan's deadline).
  const effectiveGoal = resolveEffectiveGoal({
    clientGoal: toClientGoalInput(currentGoals, client),
    // Client-local today: the pace window is on the client's calendar. The
    // client record is already in scope, so resolve their zone directly.
    today: getTodayDateStringInTimezone(client.timezone),
  });

  // Goal deadline, used by both the weight pace check and the deadline card —
  // from the SAME scope as the goal weight (no cross-scope mismatch).
  const goalDeadline = effectiveGoal.deadline ?? undefined;
  // Whole-day difference anchored to the client's local midnight (the pace window
  // is on the client's calendar), not Date.now() ms-math that reads -1 across a
  // UTC day boundary while the client still has today — mirrors getDaysUntilOrPastDue.
  // "T00:00:00" parses local-midnight to match getTodayInTimezone (NOT parseISODate,
  // which is UTC midnight).
  const daysRemaining = goalDeadline
    ? differenceInDays(
        new Date(goalDeadline + "T00:00:00"),
        getTodayInTimezone(client.timezone)
      )
    : null;
  const weeksRemaining = daysRemaining !== null ? daysRemaining / 7 : null;

  const timeBetweenCheckIns = previousCheckIn
    ? calculateDaysBetween(currentCheckIn.createdAt, previousCheckIn.createdAt)
    : undefined;

  // The recent set (ten check-ins) feeds one thing: the average change per
  // week, which is the TREND behind `isOnTrack` — body fat's only trend signal,
  // and weight's when there is no deadline to pace against. Their readings are
  // the measurement log's rows stamped with each check-in (rule 6: what a
  // check-in reported), folded in by getClientCheckIns.
  const weightCheckIns = checkIns.filter((ci) => ci.weight);
  let avgWeeklyWeightChange: number | undefined;
  if (weightCheckIns.length >= 2) {
    const oldestWeight = weightCheckIns[weightCheckIns.length - 1].weight!;
    const newestWeight = weightCheckIns[0].weight!;
    const daysBetween = calculateDaysBetween(
      weightCheckIns[0].createdAt,
      weightCheckIns[weightCheckIns.length - 1].createdAt
    );
    if (daysBetween > 0) {
      const totalChange = newestWeight - oldestWeight;
      avgWeeklyWeightChange = Number(
        ((totalChange / daysBetween) * 7).toFixed(2)
      );
    }
  }

  // Calculate body fat average change
  const bodyFatCheckIns = checkIns.filter((ci) => ci.bodyFatPercentage);
  let avgBodyFatChange: number | undefined;
  if (bodyFatCheckIns.length >= 2) {
    const oldest = bodyFatCheckIns[bodyFatCheckIns.length - 1].bodyFatPercentage!;
    const newest = bodyFatCheckIns[0].bodyFatPercentage!;
    avgBodyFatChange = Number(
      ((newest - oldest) / bodyFatCheckIns.length).toFixed(2)
    );
  }

  // The start value: the client record's baseline — the reading as of their
  // start date, derived from the measurement log — else their current reading,
  // so a client with no start date still has a direction to be judged in.
  // Never the check-in under review: it may carry no reading at all.
  const startingWeight = client.startingWeight ?? client.currentWeight;
  const startingBodyFat = client.startingBodyFatPercentage ?? client.currentBodyFatPercentage;

  // Where they stand: the client RECORD's current reading against the goal,
  // composed by the one kernel. The check-in is a report of what the client
  // typed this week, every field on it optional, and is not an input here —
  // the band's `changes` below are where it speaks.
  const goalProgress = deriveGoalProgress({
    effectiveGoal,
    client: {
      currentWeight: client.currentWeight,
      currentBodyFatPercentage: client.currentBodyFatPercentage,
      startingWeight,
      startingBodyFatPercentage: startingBodyFat,
    },
    trend: { avgWeeklyWeightChange, avgBodyFatChange },
    daysRemaining,
    weeksRemaining,
  });

  // Build comparison data
  const comparison: CheckInComparison = {
    previous: previousCheckIn,
    client: {
      id: client.id,
      name: client.name,
      // The kernel's rounded goals, so the band and the strip print one number.
      goalWeight: goalProgress.weight?.goal,
      goalBodyFatPercentage: goalProgress.bodyFat?.goal,
      goalDeadline,
      currentWeight: client.currentWeight,
      currentBodyFatPercentage: client.currentBodyFatPercentage,
      unitPreference: client.unitPreference,
      nutritionPlanBaseWeightKg: activePlan?.base_weight_kg ?? undefined,
      // The covering version's effective_from — when the numbers the banner
      // compares against actually took effect (renamed from
      // nutritionPlanCreatedDate, which under in-place editing had drifted to
      // meaning "when the first-ever plan row was born").
      nutritionPlanEffectiveDate: activePlan?.effective_from ?? undefined,
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
