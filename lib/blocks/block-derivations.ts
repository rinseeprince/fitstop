import { daysBetween } from "@/utils/metric-points";
import { weeksSpanned } from "@/lib/blocks/block-chain";
import type { BlockState, ClientBlock } from "@/types/client-blocks";

// The three derived reads for journey blocks (Session 2 Task 2.3) — pure,
// client-safe, all from dates. Nothing here is stored: current/past/future,
// week-of-total and pace exist only at read time (workstream invariant 2).
// No rounding anywhere — display rounding belongs to the renderer (the
// Session 1.2 energy-helper precedent).

export interface BlockDates {
  startsOn: string;
  endsOn: string;
}

/** ISO-string comparison; `today` is the CLIENT's calendar day. */
export function deriveBlockState(block: BlockDates, today: string): BlockState {
  if (block.endsOn < today) return "past";
  if (block.startsOn > today) return "future";
  return "current";
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
 *  ones; dates are the truth, `weeks` is display + form seed. Pace is
 *  deliberately absent — see derivePace. */
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

export interface BlockEndingFacts {
  name: string;
  /** The current block's last day. */
  endsOn: string;
  /** The following chain entry's name; null when nothing is scheduled after. */
  nextName: string | null;
}

/**
 * The "this block is in its final 7 days" signal behind the Overview's
 * coach-action row: fires while `today` sits within [endsOn − 6, endsOn] of
 * the CURRENT block. Days-remaining, deliberately NOT
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
  if (daysBetween(today, current.endsOn) > 6) return null;
  return {
    name: current.name,
    endsOn: current.endsOn,
    nextName: blocks[index + 1]?.name ?? null,
  };
}

/**
 * Pace inputs are UNIT-AGNOSTIC: the three weights must share one unit
 * system, and every output weight is in that system. Session 3 feeds the
 * merged coach series (already converted to the viewer's unit at source), so
 * the readout matches the Weight column beside it by construction; a server
 * caller may feed canonical kg instead. Mixing systems here is a bug.
 */
export interface BlockPaceInputs extends BlockDates {
  /** The block's target weight; null = no target, no pace. */
  targetWeight: number | null;
  /** Latest weight at or before startsOn; null = no baseline, no pace. */
  startWeight: number | null;
  /** Latest weight overall; null = nothing to compare, no pace. */
  currentWeight: number | null;
  today: string;
}

export interface BlockPace {
  target: number;
  current: number;
  /** current − target: positive = above target. The renderer picks
   *  "to go" wording from the direction of travel, like goal-state.ts. */
  remaining: number;
  /** Raw weeks (fractional) from today through endsOn; 0 once elapsed. */
  weeksLeft: number;
  /** Where the linear start→target line says the weight should be today. */
  expected: number;
  /** current − expected. Sign reads ahead/behind only with the direction
   *  of travel (a positive delta is "behind" in a cut, "ahead" in a gain). */
  delta: number;
}

/**
 * Null — never a fabricated zero — when any input weight is missing
 * (invariant: no weight at or before startsOn ⇒ no pace). The elapsed
 * fraction clamps to [0, 1] so out-of-window callers (an elapsed or future
 * block) get the line's endpoint values rather than an extrapolation.
 */
export function derivePace(inputs: BlockPaceInputs): BlockPace | null {
  const { targetWeight, startWeight, currentWeight } = inputs;
  if (targetWeight === null || startWeight === null || currentWeight === null) {
    return null;
  }

  const totalDays = daysBetween(inputs.startsOn, inputs.endsOn);
  const elapsedDays = daysBetween(inputs.startsOn, inputs.today);
  const fraction =
    totalDays <= 0 ? 1 : Math.min(1, Math.max(0, elapsedDays / totalDays));
  const expected = startWeight + (targetWeight - startWeight) * fraction;

  const daysLeft = daysBetween(inputs.today, inputs.endsOn) + 1;
  const weeksLeft = Math.max(0, daysLeft) / 7;

  return {
    target: targetWeight,
    current: currentWeight,
    remaining: currentWeight - targetWeight,
    weeksLeft,
    expected,
    delta: currentWeight - expected,
  };
}
