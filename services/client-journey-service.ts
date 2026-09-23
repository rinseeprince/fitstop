import { listBlocks } from "./client-blocks-service";
import { getGoalForDate } from "./client-goals-service";
import {
  getCurrentMeasurements,
  getMeasurementSeries,
  getReadingsOnDay,
} from "./measurements-service";
import { listNutritionPlanNotesInRange } from "./nutrition-plan-service";
import { decorateBlocks } from "@/lib/blocks/block-derivations";
import { resolveEffectiveGoal } from "@/lib/goals/resolve-effective-goal";
import { dayValuesToMetricPoints } from "@/utils/metric-points";
import type { MetricPoint } from "@/utils/metric-points";
import type {
  ClientJourney,
  ClientJourneyBlock,
  ClientJourneyGoalReadings,
} from "@/types/client-journey";

/**
 * The client-facing journey read (Session 4): the client's unarchived blocks,
 * decorated exactly like the coach GET — "the client app simply shows the
 * client what the coach sees" (owner, 2026-08-12) — plus the goal, with the
 * readings its progress is judged from, and the newest weight. The goal is
 * the one in force on the client's today, with that day's deadline — the same
 * goal every client wire carries (`getGoalForDate`,
 * services/client-goals-service.ts).
 *
 * The weight is the measurement log's day-values (rule 2, the same read the
 * coach Journey and the Overview chart make), and both audiences anchor on
 * the client's calendar day. Everything here is canonical kilograms
 * (CONVENTIONS §20); the renderer converts. Archived blocks are excluded —
 * the archive curates the presented journey for both audiences (chart bands
 * alone render everything).
 *
 * Shape B: the route verifies the caller IS this client and threads the
 * client's today in; every query filters on the passed clientId.
 */

/** The weight series in canonical kg, ascending — every day's value, of any source. */
async function fetchWeightSeries(clientId: string): Promise<MetricPoint[]> {
  const series = await getMeasurementSeries(clientId, { metricKeys: ["weight"] });
  return dayValuesToMetricPoints(series.get("weight") ?? []);
}

export const getClientJourney = async (
  clientId: string,
  clientToday: string
): Promise<ClientJourney> => {
  const [allBlocks, goalToday] = await Promise.all([
    listBlocks(clientId),
    getGoalForDate(clientId, clientToday),
  ]);

  // The readings the goal's progress is judged from — the chips' rule: from
  // the reading on the goal's start day to the newest — read beside the blocks'
  // own reads rather than after them.
  const goalReadings: Promise<ClientJourneyGoalReadings | null> = goalToday
    ? Promise.all([
        getCurrentMeasurements(clientId),
        getReadingsOnDay(clientId, goalToday.startsOn),
      ]).then(([newest, onStart]) => ({
        weightKg: newest.weight?.value ?? null,
        bodyFatPercentage: newest.bodyFat?.value ?? null,
        startWeightKg: onStart.weight?.value ?? null,
        startBodyFatPercentage: onStart.bodyFat?.value ?? null,
      }))
    : Promise.resolve(null);

  // The goal in force on the client's today, from one goal: its weight target
  // and deadline as the calculator reads them — no goal, or no weight target,
  // ships a null weight — and what the client's goal card shows.
  const effective = resolveEffectiveGoal(goalToday);
  const goalOf = (readings: ClientJourneyGoalReadings | null): ClientJourney["goal"] => ({
    weightKg: effective.goalWeightKg,
    deadline: effective.deadline,
    name: goalToday?.name ?? null,
    type: goalToday?.type ?? null,
    bodyFatPercentage: effective.goalBodyFatPercentage,
    description: goalToday?.description ?? null,
    readings,
  });

  const blocks = allBlocks.filter((block) => block.archivedAt === null);
  if (blocks.length === 0) {
    return {
      clientToday,
      blocks: [],
      goal: goalOf(await goalReadings),
      currentWeightKg: null,
      currentBlockNotes: null,
    };
  }

  const decorated = decorateBlocks(blocks, clientToday);

  // THE POLICY IS ENFORCED HERE, not in the renderer (see
  // ClientJourneyCurrentBlockNotes): a client reads the coach's plan notes only
  // while the block containing them is current. This endpoint is the RN
  // contract, so shipping elapsed-block notes and trusting each client app to
  // drop them is how the two apps come to disagree about what a client may see.
  // Only the current block's window is read at all — the notes for other blocks
  // never leave the database.
  const current = decorated.find((block) => block.state === "current") ?? null;
  const [points, currentBlockNotes, readings] = await Promise.all([
    fetchWeightSeries(clientId),
    current
      ? listNutritionPlanNotesInRange(clientId, current.startsOn, current.endsOn).then(
          (notes) => ({ blockId: current.id, notes })
        )
      : Promise.resolve(null),
    goalReadings,
  ]);

  const journeyBlocks: ClientJourneyBlock[] = decorated.map((block) => ({
    id: block.id,
    name: block.name,
    focus: block.focus,
    startsOn: block.startsOn,
    endsOn: block.endsOn,
    weeks: block.weeks,
    state: block.state,
    weekOfTotal: block.weekOfTotal,
  }));

  return {
    clientToday,
    blocks: journeyBlocks,
    goal: goalOf(readings),
    currentWeightKg:
      points.length > 0 ? points[points.length - 1].value : null,
    currentBlockNotes,
  };
};
