import { listBlocks } from "./client-blocks-service";
import { getCurrentGoals } from "./client-goals-service";
import { getMeasurementSeries } from "./measurements-service";
import { listNutritionPlanNotesInRange } from "./nutrition-plan-service";
import { decorateBlocks } from "@/lib/blocks/block-derivations";
import { resolveEffectiveGoal } from "@/lib/goals/resolve-effective-goal";
import { dayValuesToMetricPoints } from "@/utils/metric-points";
import type { MetricPoint } from "@/utils/metric-points";
import type { ClientJourney, ClientJourneyBlock } from "@/types/client-journey";

/**
 * The client-facing journey read (Session 4): the client's unarchived blocks,
 * decorated exactly like the coach GET — "the client app simply shows the
 * client what the coach sees" (owner, 2026-08-12) — plus the goal and the
 * newest weight for the "to go" line.
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
  const [allBlocks, currentGoals] = await Promise.all([
    listBlocks(clientId),
    getCurrentGoals(clientId),
  ]);

  // Owner decision 2026-08-12: this endpoint reads client_goals through
  // resolveEffectiveGoal and exposes the deadline — scoped to this endpoint
  // only; the clients.* mirror reads elsewhere are unchanged.
  const effective = resolveEffectiveGoal({
    clientGoal: currentGoals
      ? {
          goalWeight: currentGoals.goalWeight ?? null,
          goalBodyFatPercentage: currentGoals.goalBodyFatPercentage ?? null,
          deadline: currentGoals.goalDeadline ?? null,
        }
      : null,
  });
  const goal = {
    weightKg: effective.goalWeightKg,
    deadline: effective.deadline,
  };

  const blocks = allBlocks.filter((block) => block.archivedAt === null);
  if (blocks.length === 0) {
    return {
      clientToday,
      blocks: [],
      goal,
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
  const [points, currentBlockNotes] = await Promise.all([
    fetchWeightSeries(clientId),
    current
      ? listNutritionPlanNotesInRange(clientId, current.startsOn, current.endsOn).then(
          (notes) => ({ blockId: current.id, notes })
        )
      : Promise.resolve(null),
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
    goal,
    currentWeightKg:
      points.length > 0 ? points[points.length - 1].value : null,
    currentBlockNotes,
  };
};
