import { supabaseAdmin } from "./supabase-admin";
import { listBlocks } from "./client-blocks-service";
import {
  getTrainingPlansOverlapping,
  type TrainingPlanWindowSummary,
} from "./training-service";
import { versionCoversDate } from "./nutrition-plan-service";
import { listNutritionPlanNotesInRange } from "./nutrition-plan-notes-service";
import { getNutritionEventsForDateRange } from "./nutrition-days-service";
import { fetchAllPages } from "@/lib/paged-fetch";
import { addDaysToDateString } from "@/lib/date-helpers";
import type { NutritionEvent } from "@/types/check-in";
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
// are constant (blocks + 5 parallel reads, one of them the day reader's own
// batch), never per-block. The span's nutrition days come from the day reader
// (services/nutrition-days-service.ts): one computed day per date a version
// covers, complete by construction — there is no day table to page.

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
 * windows cannot overlap (the gist exclusion), so at most one covers any
 * date; no covering version → null ("Not set"), which is also what a retired
 * version leaves behind — a delete archives it (migration 166). Calories
 * honour a custom-macros override; deficit = that version's tdee − calories
 * (positive = deficit), null without a tdee.
 *
 * The "Changed" marker keeps its day-based detection: baseline transitions
 * across consecutive UNMODIFIED lived days, read off the computed days —
 * while hand-edited stretches can neither flag nor mask one. No rounding
 * here; display rounding belongs to the renderer.
 */
function deriveNutritionFact(
  events: NutritionEvent[],
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
    if (event.isModified) continue;
    if (event.date < block.startsOn || event.date > windowEnd) continue;
    if (previous !== null && event.baselineCalories !== previous) {
      changeCount += 1;
      lastChangedOn = event.date;
    }
    previous = event.baselineCalories;
  }

  const calories = versionCalories(version);
  return {
    startsOn: version.effectiveFrom,
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
 * never overlap (the gist exclusion), so this is a plain intersection with the
 * block window — no resolution rule, unlike training. Gaps between them are
 * real (migration 166: a version ends where it was placed to end, and a
 * retired one is archived out of this read), and a gap simply has no era.
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
    if (version.effectiveUntil < blockStart) continue;

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
export async function getBlockFacts(
  clientId: string,
  clientToday: string
): Promise<BlockFacts[]> {
  const blocks = await listBlocks(clientId);
  if (blocks.length === 0) return [];

  const spanStart = blocks[0].startsOn;
  const spanEnd = blocks[blocks.length - 1].endsOn;

  const [plans, versions, events, notes, trainingDays] = await Promise.all([
    getTrainingPlansOverlapping(clientId, spanStart, spanEnd),
    fetchVersionTdeeWindows(clientId, spanStart, spanEnd),
    getNutritionEventsForDateRange(clientId, spanStart, spanEnd),
    listNutritionPlanNotesInRange(clientId, spanStart, spanEnd),
    // Fifth parallel read, partitioned per block in memory like the other four
    // — round trips stay constant in the number of blocks, never per-block.
    fetchTrainingEventDates(clientId, spanStart, spanEnd),
  ]);

  const segments = reduceToGoverningSegments(plans, spanStart, spanEnd);

  return blocks.map((block) => {
    // ★ A BLOCK SHOWS WHAT IS SET ONLY IF IT ACTUALLY HAS DAYS ON THE CALENDAR.
    //
    // Both columns resolve by WINDOW, and both windows end (migrations 166 and
    // 167), but the gate stays one rule for both tracks: a window says where a
    // plan was placed to run, the events say which days it actually put on the
    // calendar, and a block the coach has drawn but not set up must not claim a
    // program whose rows merely reach into it. The events are the truth for a
    // date.
    //
    // Per track, because the two are set up separately: a block can have
    // workouts and no targets, or the reverse, and each column should say only
    // what is true of its own.
    const hasTrainingDays = hasDayInBlock(trainingDays, block);
    const hasNutritionDays = hasDayInBlock(events, block);

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
      nutrition: hasNutritionDays
        ? deriveNutritionFact(events, versions, block, clientToday)
        : null,
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
