import { supabaseAdmin } from "./supabase-admin";
import { listBlocks } from "./client-blocks-service";
import { getCurrentGoals } from "./client-goals-service";
import { listMetricEntries } from "./metric-entries-service";
import { fetchAllPages } from "@/lib/paged-fetch";
import { decorateBlocks } from "@/lib/blocks/block-derivations";
import { deriveBlockWeightFacts } from "@/lib/blocks/block-weight";
import { resolveEffectiveGoal } from "@/lib/goals/resolve-effective-goal";
import {
  buildMetricPoints,
  type MetricPoint,
  type MetricSeriesDefinition,
} from "@/utils/metric-points";
import type { CheckIn } from "@/types/check-in";
import type { ClientJourney, ClientJourneyBlock } from "@/types/client-journey";

/**
 * The client-facing journey read (Session 4): the client's unarchived blocks,
 * decorated exactly like the coach GET, with the SAME weight facts the coach's
 * block card shows — "the client app simply shows the client what the coach
 * sees" (owner, 2026-08-12).
 *
 * Parity is by construction, not by convention: the series is the same merge
 * (`buildMetricPoints` over check-in weights ⊕ coach metric entries, coach
 * entry winning a same-day tie), the facts walk is the same function
 * (`deriveBlockWeightFacts`), and both audiences anchor on the client's
 * calendar day. Everything here is canonical kilograms (CONVENTIONS §20); the
 * renderer converts. Archived blocks are excluded — the archive curates the
 * presented journey for both audiences (chart bands alone render everything).
 *
 * Shape B: the route verifies the caller IS this client and threads the
 * client's today in; every query filters on the passed clientId.
 */

// Mirrors METRIC_DEFINITIONS' weight entry (use-metrics-data.ts) — the
// structural subset buildMetricPoints needs, declared here because the full
// catalog lives in a components/**/hooks module a service must not import.
const WEIGHT_DEF: MetricSeriesDefinition = {
  id: "weight",
  key: "weight",
  category: "body",
};

// The narrow check-ins projection the weight series needs. `status` is
// selected only to satisfy the CheckIn type below.
type CheckInWeightRow = {
  id: string;
  client_id: string;
  status: string;
  created_at: string | null;
  updated_at: string | null;
  weight: number | null;
};

/**
 * The merged weight series in canonical kg, ascending — identical inputs to
 * what use-merged-metrics feeds the coach card, pre-conversion.
 */
async function fetchWeightSeries(clientId: string): Promise<MetricPoint[]> {
  const [checkInRows, entries] = await Promise.all([
    // PARITY-CRITICAL — no status filter. The coach series includes every
    // check-in regardless of status (use-check-in-data.ts's page key sends
    // only limit/offset), so filtering here — even "for cleanliness" — would
    // silently desync the two surfaces with nothing failing. The weight
    // NOT NULL filter is equivalent-by-construction: buildMetricPoints skips
    // non-numeric values, so a weightless check-in contributes nothing to the
    // weight series either way. Paged: this feeds an aggregate and must be
    // complete past PostgREST's ~1000-row cap; (created_at, id) is a
    // deterministic order with a unique tiebreak.
    fetchAllPages<CheckInWeightRow>(
      (from, to) =>
        supabaseAdmin
          .from("check_ins")
          .select("id, client_id, status, created_at, updated_at, weight")
          .eq("client_id", clientId)
          .not("weight", "is", null)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      { errorLabel: "check-in weights" }
    ),
    listMetricEntries(clientId),
  ]);

  // Same createdAt fallback as mapCheckInRow, so a pathological null
  // timestamp resolves identically on both surfaces.
  const checkIns: CheckIn[] = checkInRows.map((row) => ({
    id: row.id,
    clientId: row.client_id,
    status: row.status as CheckIn["status"],
    weight: row.weight ?? undefined,
    createdAt: row.created_at ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? new Date().toISOString(),
  }));

  return buildMetricPoints(checkIns, entries, [WEIGHT_DEF]).get(WEIGHT_DEF.id) ?? [];
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
          startDate: currentGoals.goalStartDate ?? null,
        }
      : null,
    today: clientToday,
  });
  const goal = {
    weightKg: effective.goalWeightKg,
    deadline: effective.deadline,
  };

  const blocks = allBlocks.filter((block) => block.archivedAt === null);
  if (blocks.length === 0) {
    return { clientToday, blocks: [], goal, currentWeightKg: null };
  }

  const points = await fetchWeightSeries(clientId);
  const journeyBlocks: ClientJourneyBlock[] = decorateBlocks(
    blocks,
    clientToday
  ).map((block) => {
    const facts = deriveBlockWeightFacts(points, block);
    return {
      id: block.id,
      name: block.name,
      focus: block.focus,
      targetWeightKg: block.targetWeightKg,
      startsOn: block.startsOn,
      endsOn: block.endsOn,
      weeks: block.weeks,
      state: block.state,
      weekOfTotal: block.weekOfTotal,
      startWeightKg: facts.start?.value ?? null,
      endWeightKg: facts.end?.value ?? null,
    };
  });

  return {
    clientToday,
    blocks: journeyBlocks,
    goal,
    currentWeightKg:
      points.length > 0 ? points[points.length - 1].value : null,
  };
};
