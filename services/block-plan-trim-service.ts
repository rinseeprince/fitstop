import { supabaseAdmin } from "./supabase-admin";
import { addDaysToDateString } from "@/lib/date-helpers";
import { chunkIds, fetchAllByChunkedIds } from "@/lib/paged-fetch";
import {
  planBlockTrims,
  type BlockTrimTarget,
  type TrimmablePlan,
} from "@/lib/blocks/block-plan-trims";
import type { BlockPlanTrim } from "@/types/client-blocks";
import { resolveEventDeletionFloor } from "./event-deletion-floor";
import { cancelFutureEventsForPlans } from "./training-event-service";
import { endTrainingPlansAt } from "./training-plan-clear-service";
import { endNutritionVersionsAt } from "./nutrition-plan-clear-service";

/**
 * A block contains its plans: drawing a block, or shortening one, over days
 * that already hold a plan trims the plans to fit (the rule is
 * `lib/blocks/block-plan-trims.ts`). The chain PUT finds the trims before it
 * writes a block row, refuses the save until the coach says yes to them, and
 * then applies them — before the rows, so every state a failure can leave is
 * one a retry of the same save finishes: each step re-reads the calendar, and
 * a trimmed plan already fits.
 *
 * Both tracks end a plan the way their own delete does, through the same
 * statements (`endNutritionVersionsAt`, `endTrainingPlansAt`), on the day the
 * block allows rather than yesterday.
 */

/**
 * Every plan the save changes: the live programs and versions with a day still
 * ahead that reach the blocks being drawn or shortened, through the rule.
 * Programs first, then targets, each in start order — the question's order.
 */
export async function findBlockPlanTrims(
  clientId: string,
  clientToday: string,
  targets: BlockTrimTarget[]
): Promise<BlockPlanTrim[]> {
  if (targets.length === 0) return [];

  const spanStart = targets.reduce(
    (earliest, target) => (target.startsOn < earliest ? target.startsOn : earliest),
    targets[0].startsOn
  );
  const spanEnd = targets.reduce(
    (latest, target) => (target.previousEndsOn > latest ? target.previousEndsOn : latest),
    targets[0].previousEndsOn
  );
  // A plan that ended before today is history, and nothing reaching the span
  // ends before its start.
  const reachesFrom = spanStart > clientToday ? spanStart : clientToday;

  const [programs, versions] = await Promise.all([
    supabaseAdmin
      .from("training_plans")
      .select("id, name, effective_from, effective_until")
      .eq("client_id", clientId)
      .is("deleted_at", null)
      .neq("status", "archived")
      .gte("effective_until", reachesFrom)
      .lte("effective_from", spanEnd)
      .order("effective_from", { ascending: true }),
    supabaseAdmin
      .from("nutrition_plans")
      .select("id, effective_from, effective_until")
      .eq("client_id", clientId)
      .eq("status", "active")
      .gte("effective_until", reachesFrom)
      .lte("effective_from", spanEnd)
      .order("effective_from", { ascending: true }),
  ]);
  if (programs.error) {
    throw new Error(`Failed to read the programs the block reaches: ${programs.error.message}`);
  }
  if (versions.error) {
    throw new Error(`Failed to read the targets the block reaches: ${versions.error.message}`);
  }

  const plans: TrimmablePlan[] = [
    ...(programs.data ?? []).map((row) => ({
      track: "training" as const,
      id: row.id,
      name: row.name,
      startsOn: row.effective_from,
      endsOn: row.effective_until,
    })),
    ...(versions.data ?? []).map((row) => ({
      track: "nutrition" as const,
      id: row.id,
      name: null,
      startsOn: row.effective_from,
      endsOn: row.effective_until,
    })),
  ];
  return planBlockTrims(plans, targets, clientToday);
}

/** The last day a trimmed plan keeps — the day before its start when it goes. */
function lastDayOf(trim: BlockPlanTrim): string {
  return trim.newEndsOn ?? addDaysToDateString(trim.startsOn, -1);
}

function toEnd(trim: BlockPlanTrim) {
  return {
    id: trim.id,
    effective_from: trim.startsOn,
    effective_until: trim.endsOn,
    lastDay: lastDayOf(trim),
  };
}

/**
 * The session rows behind the days a trim removed go inactive with them, so a
 * trimmed program's rows describe the days it keeps. A row a remaining day
 * still points at stays: a duplicated session shares its row, and the day
 * reads its session through it.
 */
async function retireRowsLeftBehind(planIds: string[], sessionIds: string[]): Promise<void> {
  const removed = [...new Set(sessionIds)];
  if (removed.length === 0) return;

  const stillUsed = await fetchAllByChunkedIds<{ training_session_id: string | null }, string>(
    removed,
    (chunk, from, to) =>
      supabaseAdmin
        .from("training_events")
        .select("training_session_id")
        .in("training_session_id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
    { errorLabel: "the session rows still in use" }
  );
  const keep = new Set(stillUsed.map((row) => row.training_session_id));
  const retire = removed.filter((id) => !keep.has(id));

  const now = new Date().toISOString();
  for (const chunk of chunkIds(retire)) {
    const { error } = await supabaseAdmin
      .from("training_sessions")
      .update({ is_active: false, updated_at: now })
      .in("id", chunk)
      .in("plan_id", planIds);
    if (error) throw new Error(`Failed to retire the removed sessions' rows: ${error.message}`);
  }
}

/**
 * Apply the trims the coach said yes to. Nutrition first — the hand edits on
 * the days a version gives up, then its window — then training: the sessions
 * after each program's new last day, the rows behind them, then its window.
 * The windows move last on each track, so a failure leaves a plan still
 * reaching past its block, where the retry finds it again.
 *
 * A program's sessions go from the day after its new last day, never before
 * the deletion floor (a today the client has trained on keeps its session); a
 * program the trim leaves no day goes the way Delete plan removes one, from
 * the floor. Logged days are detached, never deleted.
 */
export async function applyBlockPlanTrims(
  clientId: string,
  clientToday: string,
  trims: BlockPlanTrim[]
): Promise<void> {
  const versions = trims.filter((trim) => trim.track === "nutrition");
  const programs = trims.filter((trim) => trim.track === "training");

  await endNutritionVersionsAt(clientId, versions.map(toEnd));
  if (programs.length === 0) return;

  const floor = await resolveEventDeletionFloor(clientId, clientToday);
  const idsByFirstRemovedDay = new Map<string, string[]>();
  for (const program of programs) {
    const dayAfter = addDaysToDateString(lastDayOf(program), 1);
    const from = program.newEndsOn !== null && dayAfter > floor ? dayAfter : floor;
    idsByFirstRemovedDay.set(from, [...(idsByFirstRemovedDay.get(from) ?? []), program.id]);
  }

  const removedSessionIds: string[] = [];
  for (const [from, ids] of idsByFirstRemovedDay) {
    removedSessionIds.push(...(await cancelFutureEventsForPlans(ids, from)));
  }
  await retireRowsLeftBehind(
    programs.map((program) => program.id),
    removedSessionIds
  );
  await endTrainingPlansAt(programs.map(toEnd));
}
