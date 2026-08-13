import { supabaseAdmin } from "./supabase-admin";
import { listBlocks } from "./client-blocks-service";
import {
  getTrainingPlansOverlapping,
  type TrainingPlanWindowSummary,
} from "./training-service";
import { versionCoversDate } from "./nutrition-plan-service";
import { listNutritionPlanNotesInRange } from "./nutrition-plan-notes-service";
import { fetchAllPages } from "@/lib/paged-fetch";
import { addDaysToDateString } from "@/lib/date-helpers";
import type {
  BlockFacts,
  BlockNutritionEra,
  BlockNutritionFact,
  ClientBlock,
} from "@/types/client-blocks";

// Read-only facts for the Journey tab's expanded block cards (Session 3.2).
// The chain routes stay pure CRUD; this service decorates each block with the
// training and nutrition story of its window. Everything is fetched ONCE for
// the whole journey span and partitioned per block in memory — round trips
// are constant (blocks + 3 parallel reads), never per-block.

type EventCaloriesRow = {
  date: string;
  baseline_calories: number | null;
  is_modified: boolean;
};

/**
 * Complete narrow read of the span's event calories. Paged via fetchAllPages
 * because this feeds an aggregate (the modal baseline) — an unpaged read
 * silently truncates at PostgREST's ~1000-row cap, which a 20-block journey
 * at 12 weeks each (1,680 dense event days) already crosses. `date` is unique
 * per client (`nutrition_events UNIQUE(client_id, date)`), so ordering by it
 * satisfies the deterministic-order contract with no extra tiebreak. Worst
 * case: 20 blocks × 52 weeks = 7,280 rows ≈ 8 pages of 3 columns each;
 * a realistic 12–40-week journey is 84–280 rows, one page.
 */
async function fetchEventCalories(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<EventCaloriesRow[]> {
  return fetchAllPages<EventCaloriesRow>(
    (from, to) =>
      supabaseAdmin
        .from("nutrition_events")
        .select("date, baseline_calories, is_modified")
        .eq("client_id", clientId)
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: true })
        .range(from, to),
    { errorLabel: "block-facts nutrition events" }
  );
}

type VersionTdeeWindow = {
  id: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  tdee: number | null;
  baselineCalories: number;
  customMacrosEnabled: boolean;
  customCalories: number | null;
};

/**
 * Active versions overlapping the span, with the PRESCRIPTION fields
 * (baseline/custom calories + tdee). Deliberately NOT
 * `getActiveNutritionPlanVersionsOverlapping`: that helper is the cascade's
 * segmentation primitive and its window type carries none of these —
 * widening a write-path primitive for a read-only facts column couples the
 * two. Same overlap predicate and status filter; single-digit rows per
 * client, unpaged.
 */
async function fetchVersionTdeeWindows(
  clientId: string,
  rangeStart: string,
  rangeEnd: string
): Promise<VersionTdeeWindow[]> {
  const { data, error } = await supabaseAdmin
    .from("nutrition_plans")
    .select(
      "id, effective_from, effective_until, tdee, baseline_calories, custom_macros_enabled, custom_calories"
    )
    .eq("client_id", clientId)
    .eq("status", "active")
    .lte("effective_from", rangeEnd)
    .or(`effective_until.gte.${rangeStart},effective_until.is.null`)
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
  }));
}

/**
 * The block's nutrition fact — owner-specified semantics (Session 3.7
 * follow-up, superseding the 3.2 dominant-era modal, which sourced its
 * headline from events and became blind the moment hand-edits dominated a
 * window): show the PRESCRIPTION, i.e. the plan VERSION's own daily calories
 * and deficit, with per-day hand edits and training surpluses ignored by
 * construction (the plan row never contains either).
 *
 * The reference date picks WHICH era's prescription: a current block reads
 * the version covering TODAY ("what are they on now"), a past block the
 * version covering its final day ("what they finished on"), a future block
 * the version covering its first day (the queued prescription). Version
 * windows cannot overlap (the migration-144 gist exclusion), so at most one
 * covers any date; no covering version → null ("Not set"). Calories honour a
 * custom-macros override; deficit = that version's tdee − calories (positive
 * = deficit), null without a tdee.
 *
 * The "Changed" marker keeps its event-based detection: baseline transitions
 * across consecutive UNMODIFIED lived days. That catches every prescription
 * change that regenerated events — including pre-versioning history no plan
 * row remembers — while hand-edited stretches can neither flag nor mask one.
 * Pre-versioning caveat, recorded: for blocks that ended before migration
 * 144, the single legacy version's window covers them and its LAST-saved
 * numbers stand in for eras the row no longer remembers — the events-era
 * marker is the honest "it changed" signal there. No rounding here; display
 * rounding belongs to the renderer.
 */
function deriveNutritionFact(
  events: EventCaloriesRow[],
  versions: VersionTdeeWindow[],
  block: ClientBlock,
  clientToday: string
): BlockNutritionFact | null {
  const isCurrent = block.startsOn <= clientToday && clientToday <= block.endsOn;
  const windowEnd = isCurrent ? clientToday : block.endsOn;
  const referenceDate =
    block.startsOn > clientToday
      ? block.startsOn
      : block.endsOn < clientToday
        ? block.endsOn
        : clientToday;

  const version =
    versions.find((v) => versionCoversDate(v, referenceDate)) ?? null;
  if (!version) return null;

  let changeCount = 0;
  let lastChangedOn: string | null = null;
  let previous: number | null = null;
  for (const event of events) {
    if (event.is_modified || event.baseline_calories == null) continue;
    if (event.date < block.startsOn || event.date > windowEnd) continue;
    if (previous !== null && event.baseline_calories !== previous) {
      changeCount += 1;
      lastChangedOn = event.date;
    }
    previous = event.baseline_calories;
  }

  const calories = versionCalories(version);
  return {
    calories,
    deficitPerDay: version.tdee != null ? version.tdee - calories : null,
    changeCount,
    lastChangedOn,
    eras: deriveEras(versions, block.startsOn, windowEnd),
  };
}

/** A version's own daily target, custom-macros override honoured. */
function versionCalories(version: VersionTdeeWindow): number {
  return version.customMacrosEnabled && version.customCalories != null
    ? version.customCalories
    : version.baselineCalories;
}

/**
 * The prescription era by era, for the block's "what happened" timeline.
 *
 * The version rows ARE the era log: `[effective_from, effective_until]` windows
 * tile the client's timeline by construction, so this is a plain intersection
 * with the block window — no resolution rule, unlike training, because the
 * migration-144 gist exclusion makes overlapping active windows impossible.
 *
 * Each era carries the numbers off its OWN row. The block headline reads the
 * reference-date version instead, which is right for "what are they on now" and
 * wrong for a dated history entry: those numbers change on every plan save, so a
 * past entry sourced from them would silently rewrite itself.
 *
 * `windowEnd` is the caller's — today for a current block — so a queued version
 * dated in the future never appears in a log of what happened.
 */
function deriveEras(
  versions: VersionTdeeWindow[],
  blockStart: string,
  windowEnd: string
): BlockNutritionEra[] {
  const eras: BlockNutritionEra[] = [];
  // Query order is `effective_from ASC`, and windows cannot overlap, so this
  // walk is already chronological.
  for (const version of versions) {
    if (version.effectiveFrom > windowEnd) continue;
    if (version.effectiveUntil !== null && version.effectiveUntil < blockStart) continue;

    const calories = versionCalories(version);
    const deficitPerDay = version.tdee != null ? version.tdee - calories : null;

    // A save that left the numbers where they were did not change anything the
    // coach would recognise, so it earns no entry.
    const previous = eras[eras.length - 1];
    if (
      previous &&
      previous.calories === calories &&
      previous.deficitPerDay === deficitPerDay
    ) {
      continue;
    }

    eras.push({
      from: version.effectiveFrom > blockStart ? version.effectiveFrom : blockStart,
      calories,
      deficitPerDay,
    });
  }
  return eras;
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
    if (plan.effectiveUntil !== null && plan.effectiveUntil < date) continue;
    if (!best || plan.effectiveFrom > best.effectiveFrom) best = plan;
  }
  return best;
}

export interface GoverningPlanSegment {
  plan: TrainingPlanWindowSummary;
  from: string;
  to: string;
}

/**
 * Reduce coach-visible plans to the segments where each actually GOVERNED —
 * the per-date winner under getTrainingPlanForDate's latest-start-wins rule.
 * Raw window overlap over-includes: placed plans keep `effective_until =
 * NULL` forever, so a January program "overlaps" every later block even
 * though a March one took over — a client's fourth block would list all
 * four programs. The winner only changes at a plan's start or the day after
 * one's window closes, so those are the only boundaries evaluated. A capped
 * plan expiring hands govern-ship BACK to the older open plan for the days
 * after its `effective_until` — exactly what per-date resolution answers.
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
    if (plan.effectiveUntil !== null) {
      const dayAfter = addDaysToDateString(plan.effectiveUntil, 1);
      if (dayAfter > spanStart && dayAfter <= spanEnd) {
        boundarySet.add(dayAfter);
      }
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
export async function getBlockFacts(
  clientId: string,
  clientToday: string
): Promise<BlockFacts[]> {
  const blocks = await listBlocks(clientId);
  if (blocks.length === 0) return [];

  const spanStart = blocks[0].startsOn;
  const spanEnd = blocks[blocks.length - 1].endsOn;

  const [plans, versions, events, notes] = await Promise.all([
    getTrainingPlansOverlapping(clientId, spanStart, spanEnd),
    fetchVersionTdeeWindows(clientId, spanStart, spanEnd),
    fetchEventCalories(clientId, spanStart, spanEnd),
    // Fourth parallel read, partitioned per block in memory like the other
    // three — round trips stay constant in the number of blocks, never per-block.
    listNutritionPlanNotesInRange(clientId, spanStart, spanEnd),
  ]);

  const segments = reduceToGoverningSegments(plans, spanStart, spanEnd);

  return blocks.map((block) => {
    const training: BlockFacts["training"] = [];
    for (const segment of segments) {
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
      nutrition: deriveNutritionFact(events, versions, block, clientToday),
      // Inclusive on both ends and NOT clamped to today, unlike the nutrition
      // eras: a note dated inside a future block is a plan the coach has
      // already queued and explained, and hiding it until the date arrives
      // would hide their own reasoning from them.
      notes: notes.filter(
        (note) => note.effectiveOn >= block.startsOn && note.effectiveOn <= block.endsOn
      ),
    };
  });
}
