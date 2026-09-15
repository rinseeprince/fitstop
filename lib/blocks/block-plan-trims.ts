import { addDaysToDateString } from "@/lib/date-helpers";
import type { BlockPlanTrim } from "@/types/client-blocks";

// A block contains its plans: no plan on either track crosses a block's edge.
// Drawing a block, or shortening one, over days that already hold a plan
// trims the plans to fit — this is the rule, pure, the same on both tracks
// and judged from dates alone (no plan carries a block id).
//
// - A plan that started before a block that has not begun ends the day before
//   the block starts. A plan is one row, so its days after the block go too.
// - A plan that starts inside the block and runs past its end ends on the
//   block's last day.
// - A plan starting in the days a shortened block gave up is left no day, and
//   is removed.
//
// A block already under way keeps its start edge: the days before today are
// lived, so a plan crossing it is judged at the end edge alone.

/** A block the save draws (`previousEndsOn` = `endsOn`) or shortens. */
export interface BlockTrimTarget {
  startsOn: string;
  endsOn: string;
  /** The stored end before a shorten; the block's own end when it is new. */
  previousEndsOn: string;
}

/** A live plan with a day still ahead, as it stands before the save. */
export type TrimmablePlan = Omit<BlockPlanTrim, "newEndsOn">;

/** undefined = the target leaves the plan alone; null = the plan is removed. */
function cutFor(
  plan: TrimmablePlan,
  target: BlockTrimTarget,
  clientToday: string
): string | null | undefined {
  if (plan.startsOn > target.endsOn && plan.startsOn <= target.previousEndsOn) {
    return null;
  }
  let cut: string | undefined;
  if (
    plan.startsOn < target.startsOn &&
    plan.endsOn >= target.startsOn &&
    target.startsOn >= clientToday
  ) {
    cut = addDaysToDateString(target.startsOn, -1);
  }
  if (plan.startsOn <= target.endsOn && plan.endsOn > target.endsOn) {
    cut = cut === undefined || target.endsOn < cut ? target.endsOn : cut;
  }
  return cut;
}

/** The earlier of two cuts; a removal is earlier than any day. */
function earlier(a: string | null | undefined, b: string | null): string | null {
  if (a === undefined) return b;
  if (a === null || b === null) return null;
  return a < b ? a : b;
}

/**
 * Every plan the save changes, with its new last day (null = removed), in the
 * order given. A plan two targets reach takes the earlier cut.
 */
export function planBlockTrims(
  plans: TrimmablePlan[],
  targets: BlockTrimTarget[],
  clientToday: string
): BlockPlanTrim[] {
  const trims: BlockPlanTrim[] = [];
  for (const plan of plans) {
    let newEndsOn: string | null | undefined;
    for (const target of targets) {
      const cut = cutFor(plan, target, clientToday);
      if (cut !== undefined) newEndsOn = earlier(newEndsOn, cut);
    }
    if (newEndsOn !== undefined) trims.push({ ...plan, newEndsOn });
  }
  return trims;
}
