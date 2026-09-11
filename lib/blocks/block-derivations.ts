import { daysBetween } from "@/utils/metric-points";
import { weeksSpanned } from "@/lib/blocks/block-chain";
import { PLAN_ENDING_LEAD_DAYS } from "@/lib/constants";
import type { BlockPlanState, BlockState, ClientBlock } from "@/types/client-blocks";

// The derived reads for journey blocks (Session 2 Task 2.3) — pure,
// client-safe, all from dates. Nothing here is stored: current/past/future
// and week-of-total exist only at read time (workstream invariant 2).
// No rounding anywhere — display rounding belongs to the renderer (the
// Session 1.2 energy-helper precedent).

interface BlockDates {
  startsOn: string;
  endsOn: string;
}

/** ISO-string comparison; `today` is the CLIENT's calendar day. */
export function deriveBlockState(block: BlockDates, today: string): BlockState {
  if (block.endsOn < today) return "past";
  if (block.startsOn > today) return "future";
  return "current";
}

/**
 * A PLAN's standing against the client's today — the same date rule as a
 * block's, in the platform's plan vocabulary: a window covering today is
 * `active`, one starting later `upcoming`, one closed before today `ended`.
 * The pure twin of the services' `coversDate` predicate, so the block card's
 * "active" is the hero's "active" on the same rows. Stamped server-side onto
 * every block fact (the facts route resolves the client's day as the chain
 * route does); the browser never re-derives it.
 */
export function derivePlanState(window: BlockDates, today: string): BlockPlanState {
  const state = deriveBlockState(window, today);
  return state === "current" ? "active" : state === "future" ? "upcoming" : "ended";
}

export interface BlockWeekOfTotal {
  current: number;
  total: number;
}

/**
 * "Week 3 of 6" — for the block containing today only; null otherwise.
 * `total` comes from `weeksSpanned` (ceil), the same single derivation behind
 * the GET's `weeks` field, so the two can never disagree — a truncated
 * 29-day block reads "week 5 of 5" on its final day and lists as 5 weeks.
 */
export function deriveWeekOfTotal(
  block: BlockDates,
  today: string
): BlockWeekOfTotal | null {
  if (deriveBlockState(block, today) !== "current") return null;
  return {
    current: Math.floor(daysBetween(block.startsOn, today) / 7) + 1,
    total: weeksSpanned(block.startsOn, block.endsOn),
  };
}

/** The wire shape of every blocks response: the stored row plus the
 *  date-only derived fields. `weeks` = weeksSpanned (ceil) — equals the
 *  authored count for untruncated blocks and the week reached for truncated
 *  ones; dates are the truth, `weeks` is display + form seed. */
export interface ClientBlockView extends ClientBlock {
  weeks: number;
  state: BlockState;
  weekOfTotal: BlockWeekOfTotal | null;
}

export function decorateBlocks(
  blocks: ClientBlock[],
  today: string
): ClientBlockView[] {
  return blocks.map((block) => ({
    ...block,
    weeks: weeksSpanned(block.startsOn, block.endsOn),
    state: deriveBlockState(block, today),
    weekOfTotal: deriveWeekOfTotal(block, today),
  }));
}

interface BlockEndingFacts {
  name: string;
  /** The current block's last day. */
  endsOn: string;
  /** The following chain entry's name; null when nothing is scheduled after. */
  nextName: string | null;
}

/**
 * The "this block is in its final PLAN_ENDING_LEAD_DAYS" signal behind the
 * Overview's coach-action row: fires while `today` sits within
 * [endsOn − (lead − 1), endsOn] of the CURRENT block — the same lead the
 * prescription-ending alerts on that card use. Days-remaining, deliberately NOT
 * `weekOfTotal.current === total`: ceil-weeks makes a truncated block's
 * "last week" as short as one day — useless for a row whose job is getting
 * the next block scheduled before this one ends. `blocks` is the chain in
 * date order (the listBlocks contract); the next block is simply the
 * following entry, which can never be archived (only elapsed blocks can be).
 */
export function deriveBlockEnding(
  blocks: (BlockDates & { name: string })[],
  today: string
): BlockEndingFacts | null {
  const index = blocks.findIndex(
    (candidate) => deriveBlockState(candidate, today) === "current"
  );
  if (index === -1) return null;
  const current = blocks[index];
  if (daysBetween(today, current.endsOn) >= PLAN_ENDING_LEAD_DAYS) return null;
  return {
    name: current.name,
    endsOn: current.endsOn,
    nextName: blocks[index + 1]?.name ?? null,
  };
}
