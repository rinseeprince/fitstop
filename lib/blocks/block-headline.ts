import type { BlockPlanState } from "@/types/client-blocks";

/**
 * The ONE entry a block card's Training or Nutrition column shows — the
 * headline — chosen by precedence over the states the server stamped, never by
 * a date: the plan in force today, else the first one queued in the block,
 * else the last one that ran. So a running block shows its running plan, a
 * running block whose only plan starts tomorrow shows it as planned, a future
 * block shows the plan that will govern its first day, a finished block shows
 * the plan that governed its last day — and a program that ended early with
 * nothing queued after it still headlines its block, as ended, with the way in
 * beside it (owner, 2026-09-11). Anything queued later in the block is left to
 * the timeline, which reads the whole list; the day the next plan takes over,
 * the headline moves to it, because its state does.
 *
 * `facts` is the wire's list, in start order (the facts service's contract),
 * so "first" and "last" are chronological. Pure and client-safe: the card calls
 * it; a server wire that ever needs a headline calls the same function.
 */
export function selectHeadlineFact<T extends { state: BlockPlanState }>(
  facts: readonly T[]
): T | null {
  const active = facts.find((fact) => fact.state === "active");
  if (active) return active;
  const upcoming = facts.find((fact) => fact.state === "upcoming");
  if (upcoming) return upcoming;
  for (let i = facts.length - 1; i >= 0; i--) {
    if (facts[i].state === "ended") return facts[i];
  }
  return null;
}
