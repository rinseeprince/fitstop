import { supabaseAdmin } from "./supabase-admin";
import { listBlocks } from "./client-blocks-service";
import {
  getTrainingPlansOverlapping,
  type TrainingPlanWindowSummary,
} from "./training-service";
import { fetchAllPages } from "@/lib/paged-fetch";
import { addDaysToDateString } from "@/lib/date-helpers";
import type {
  BlockFacts,
  BlockNutritionFact,
  ClientBlock,
} from "@/types/client-blocks";

// Read-only facts for the Journey tab's expanded block cards (Session 3.2).
// The chain routes stay pure CRUD; this service decorates each block with the
// training and nutrition story of its window. Everything is fetched ONCE for
// the whole journey span and partitioned per block in memory — round trips
// are constant (blocks + 3 parallel reads), never per-block. Nothing per day is
// read for nutrition: a day's target is computed from the version covering it,
// so the versions ARE the block's nutrition days.

/**
 * The dates the client has a TRAINING event on, across the span. Narrow (one
 * column) and status-agnostic: the question is whether the block has days on
 * the calendar at all, and a completed or missed day is still a day.
 *
 * Paged for the same reason as the calorie read — one event per day means a
 * 20-block journey at 52 weeks each crosses PostgREST's ~1000-row cap, and a
 * truncated read here would silently report a block as untouched.
 */
async function fetchTrainingEventDates(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<{ date: string }[]> {
  return fetchAllPages<{ date: string }>(
    (from, to) =>
      supabaseAdmin
        .from("training_events")
        .select("date")
        .eq("client_id", clientId)
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: true })
        .range(from, to),
    { errorLabel: "block-facts training events" }
  );
}

/** Does this block own any day on the calendar? */
function hasDayInBlock(rows: { date: string }[], block: ClientBlock): boolean {
  return rows.some(
    (row) => row.date >= block.startsOn && row.date <= block.endsOn
  );
}

type VersionTdeeWindow = {
  id: string;
  effectiveFrom: string;
  effectiveUntil: string;
  tdee: number | null;
  baselineCalories: number;
  customMacrosEnabled: boolean;
  customCalories: number | null;
  coachNote: string | null;
};

/**
 * Active versions overlapping the span, with the PRESCRIPTION fields
 * (baseline/custom calories + tdee) and the save note (migration 172 — a
 * column on the version, so an archived version takes its note out of the
 * facts by construction). Deliberately NOT
 * `getNutritionPrescriptionsForRange`: that read carries the three fields a
 * computed day is priced from and none of these — widening the day reader's
 * version read for a read-only facts column couples the two. Same overlap
 * predicate and status filter; single-digit rows per client, unpaged.
 */
async function fetchVersionTdeeWindows(
  clientId: string,
  rangeStart: string,
  rangeEnd: string
): Promise<VersionTdeeWindow[]> {
  const { data, error } = await supabaseAdmin
    .from("nutrition_plans")
    .select(
      "id, effective_from, effective_until, tdee, baseline_calories, custom_macros_enabled, custom_calories, coach_note"
    )
    .eq("client_id", clientId)
    .eq("status", "active")
    .lte("effective_from", rangeEnd)
    .gte("effective_until", rangeStart)
    .order("effective_from", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to fetch nutrition versions for block facts: ${error.message}`
    );
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
    tdee: row.tdee,
    baselineCalories: row.baseline_calories,
    customMacrosEnabled: row.custom_macros_enabled,
    customCalories: row.custom_calories,
    coachNote: row.coach_note,
  }));
}

/**
 * The block's nutrition facts — the same shape as its training facts (owner,
 * 2026-09-10): every active version whose window overlaps the block, in start
 * order, each carrying its OWN row's numbers, its own start and its save note. A queued
 * version inside a current block is listed exactly as a queued program is; a
 * version that began before the block keeps its real start, as a crossing
 * program's `startsOn` does; a re-save with the same numbers is its own entry,
 * as a program placed twice is. There is no reference date and no headline —
 * the list is the answer, and an empty list is "Not set".
 *
 * Version windows never overlap (the gist exclusion) and may leave gaps, so
 * this is a plain intersection with the block window — no resolution rule,
 * unlike training's latest-start-wins segments. Query order is
 * `effective_from ASC`, so the list is chronological. Calories honour a
 * custom-macros override; deficit = tdee − calories (positive = deficit), null
 * without a tdee. No rounding here; display rounding belongs to the renderer.
 */
function deriveNutritionFacts(
  versions: VersionTdeeWindow[],
  block: ClientBlock
): BlockNutritionFact[] {
  const facts: BlockNutritionFact[] = [];
  for (const version of versions) {
    if (version.effectiveFrom > block.endsOn) continue;
    if (version.effectiveUntil < block.startsOn) continue;
    const calories = versionCalories(version);
    facts.push({
      id: version.id,
      startsOn: version.effectiveFrom,
      calories,
      deficitPerDay: version.tdee != null ? version.tdee - calories : null,
      note: version.coachNote,
    });
  }
  return facts;
}

/** A version's own daily target, custom-macros override honoured. */
function versionCalories(version: VersionTdeeWindow): number {
  return version.customMacrosEnabled && version.customCalories != null
    ? version.customCalories
    : version.baselineCalories;
}

/** The plan that GOVERNS `date` under the resolution rule: latest
 *  `effective_from` wins among covering plans. Same-day ties fall to list
 *  order — `getTrainingPlansOverlapping` orders `created_at DESC` within a
 *  start date, so the first-seen of a tied pair is the resolution winner. */
function governingPlanAt(
  plans: TrainingPlanWindowSummary[],
  date: string
): TrainingPlanWindowSummary | null {
  let best: TrainingPlanWindowSummary | null = null;
  for (const plan of plans) {
    if (plan.effectiveFrom > date) continue;
    if (plan.effectiveUntil < date) continue;
    if (!best || plan.effectiveFrom > best.effectiveFrom) best = plan;
  }
  return best;
}

interface GoverningPlanSegment {
  plan: TrainingPlanWindowSummary;
  from: string;
  to: string;
}

/**
 * Reduce coach-visible plans to the segments where each actually GOVERNED —
 * the per-date winner under getTrainingPlanForDate's latest-start-wins rule.
 * Both ends are on the row and live windows cannot overlap (migration 167),
 * so for live plans this is a plain intersection with the span; the per-date
 * resolution stays for the one tie the exclusion cannot see — a `draft` or
 * `planned` row sharing a live plan's days — and so boundaries are evaluated
 * once rather than per day. The winner only changes at a plan's start or the
 * day after one's window closes, so those are the only boundaries evaluated.
 */
export function reduceToGoverningSegments(
  plans: TrainingPlanWindowSummary[],
  spanStart: string,
  spanEnd: string
): GoverningPlanSegment[] {
  const boundarySet = new Set<string>([spanStart]);
  for (const plan of plans) {
    if (plan.effectiveFrom > spanStart && plan.effectiveFrom <= spanEnd) {
      boundarySet.add(plan.effectiveFrom);
    }
    const dayAfter = addDaysToDateString(plan.effectiveUntil, 1);
    if (dayAfter > spanStart && dayAfter <= spanEnd) {
      boundarySet.add(dayAfter);
    }
  }
  const boundaries = [...boundarySet].sort();

  const segments: GoverningPlanSegment[] = [];
  for (let i = 0; i < boundaries.length; i++) {
    const from = boundaries[i];
    const to =
      i + 1 < boundaries.length
        ? addDaysToDateString(boundaries[i + 1], -1)
        : spanEnd;
    const winner = governingPlanAt(plans, from);
    if (!winner) continue;
    const last = segments[segments.length - 1];
    if (last && last.plan.id === winner.id) {
      last.to = to; // merge adjacent segments of the same plan
    } else {
      segments.push({ plan: winner, from, to });
    }
  }
  return segments;
}

/** Per-block server facts for the whole chain, in chain order. */
export async function getBlockFacts(clientId: string): Promise<BlockFacts[]> {
  const blocks = await listBlocks(clientId);
  if (blocks.length === 0) return [];

  const spanStart = blocks[0].startsOn;
  const spanEnd = blocks[blocks.length - 1].endsOn;

  const [plans, versions, trainingDays] = await Promise.all([
    getTrainingPlansOverlapping(clientId, spanStart, spanEnd),
    fetchVersionTdeeWindows(clientId, spanStart, spanEnd),
    // Third parallel read, partitioned per block in memory like the other
    // two — round trips stay constant in the number of blocks, never per-block.
    fetchTrainingEventDates(clientId, spanStart, spanEnd),
  ]);

  const segments = reduceToGoverningSegments(plans, spanStart, spanEnd);

  return blocks.map((block) => {
    // ★ A BLOCK SHOWS WHAT IS SET ONLY IF IT ACTUALLY HAS DAYS INSIDE IT.
    //
    // On training the gate is the events: a window says where a program was
    // placed to run, the events say which days it actually put on the
    // calendar, and a block the coach has drawn but not set up must not claim a
    // program whose rows merely reach into it. On nutrition a day's target is
    // computed from the version covering it, so a version overlapping the block
    // IS a day inside it — the versions read answers the gate on its own, and
    // an empty list is "Not set". Per track, because the two are set up
    // separately: a block can have workouts and no targets, or the reverse.
    const hasTrainingDays = hasDayInBlock(trainingDays, block);

    const training: BlockFacts["training"] = [];
    for (const segment of hasTrainingDays ? segments : []) {
      if (segment.from > block.endsOn || segment.to < block.startsOn) continue;
      if (training.some((fact) => fact.id === segment.plan.id)) continue;
      training.push({
        id: segment.plan.id,
        name: segment.plan.name,
        startsOn: segment.plan.effectiveFrom,
      });
    }
    return {
      blockId: block.id,
      training,
      nutrition: deriveNutritionFacts(versions, block),
    };
  });
}
