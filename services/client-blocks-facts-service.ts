import { supabaseAdmin } from "./supabase-admin";
import { listBlocks } from "./client-blocks-service";
import { getTrainingPlansOverlapping } from "./training-service";
import { derivePlanState } from "@/lib/blocks/block-derivations";
import type {
  BlockFacts,
  BlockNutritionFact,
  BlockTrainingFact,
  ClientBlock,
} from "@/types/client-blocks";

// Read-only facts for the Journey tab's expanded block cards (Session 3.2).
// The chain routes stay pure CRUD; this service decorates each block with the
// plans its DATES hold, on both tracks. Everything is fetched ONCE for the
// whole journey span and partitioned per block in memory — round trips are
// constant (the blocks plus two parallel reads), never per-block. Nothing per
// day is read on either track: a plan belongs to a block by its dates, and a
// day's target is computed from the version covering it, so the plan rows are
// the whole answer.

/** The window shared by both tracks' rows and by a block. */
type PlanWindow = { startsOn: string; endsOn: string };

/**
 * The block's plans: the ones whose days meet its own.
 *
 * A plain intersection is the whole rule, on both tracks. Live windows cannot
 * overlap each other — `training_plans_live_window_overlap` covers exactly the
 * rows `getTrainingPlansOverlapping` reads (not deleted, not archived) and
 * `nutrition_plans_active_window_overlap` covers the active versions — so no
 * date has two plans on a track and there is nothing to resolve; and a block
 * contains its plans (`lib/blocks/block-plan-trims.ts`), so what overlaps a
 * block is what runs inside it.
 */
function overlapsBlock(plan: PlanWindow, block: ClientBlock): boolean {
  return plan.startsOn <= block.endsOn && plan.endsOn >= block.startsOn;
}

type NutritionVersion = PlanWindow & {
  id: string;
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
async function fetchNutritionVersions(
  clientId: string,
  rangeStart: string,
  rangeEnd: string
): Promise<NutritionVersion[]> {
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
    startsOn: row.effective_from,
    endsOn: row.effective_until,
    tdee: row.tdee,
    baselineCalories: row.baseline_calories,
    customMacrosEnabled: row.custom_macros_enabled,
    customCalories: row.custom_calories,
    coachNote: row.coach_note,
  }));
}

/** A version's own daily target, custom-macros override honoured. */
function versionCalories(version: NutritionVersion): number {
  return version.customMacrosEnabled && version.customCalories != null
    ? version.customCalories
    : version.baselineCalories;
}

/**
 * One version's entry: its OWN row's numbers, its own window and its state.
 * Calories honour a custom-macros override; deficit = tdee − calories
 * (positive = deficit), null without a tdee. Hand edits and training surpluses
 * are excluded by construction — the plan row holds neither. No rounding here;
 * display rounding belongs to the renderer.
 */
function toNutritionFact(
  version: NutritionVersion,
  clientToday: string
): BlockNutritionFact {
  const calories = versionCalories(version);
  return {
    id: version.id,
    startsOn: version.startsOn,
    endsOn: version.endsOn,
    state: derivePlanState(version, clientToday),
    calories,
    deficitPerDay: version.tdee != null ? version.tdee - calories : null,
    note: version.coachNote,
  };
}

/**
 * Per-block server facts for the whole chain, in chain order. `clientToday` is
 * the CLIENT's calendar day (the route resolves it as the chain route does),
 * the day every entry's state is stamped against — never the coach's.
 *
 * Both lists are in start order, because both reads are: the card headlines
 * one entry by precedence over the states (`selectHeadlineFact`), and "the
 * first one queued" and "the last one that ran" are chronological. A re-save
 * with the same numbers is its own entry, as a program placed twice is; a
 * closed window is immutable, so an entry dated in the past never rewrites
 * itself on a later save.
 */
export async function getBlockFacts(
  clientId: string,
  clientToday: string
): Promise<BlockFacts[]> {
  const blocks = await listBlocks(clientId);
  if (blocks.length === 0) return [];

  const spanStart = blocks[0].startsOn;
  const spanEnd = blocks[blocks.length - 1].endsOn;

  const [plans, versions] = await Promise.all([
    getTrainingPlansOverlapping(clientId, spanStart, spanEnd),
    fetchNutritionVersions(clientId, spanStart, spanEnd),
  ]);

  const programs = plans.map((plan) => ({
    id: plan.id,
    name: plan.name,
    startsOn: plan.effectiveFrom,
    endsOn: plan.effectiveUntil,
  }));

  return blocks.map((block) => ({
    blockId: block.id,
    training: programs
      .filter((program) => overlapsBlock(program, block))
      .map(
        (program): BlockTrainingFact => ({
          ...program,
          state: derivePlanState(program, clientToday),
        })
      ),
    nutrition: versions
      .filter((version) => overlapsBlock(version, block))
      .map((version) => toNutritionFact(version, clientToday)),
  }));
}
