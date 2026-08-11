import { addDaysToDateString } from "@/lib/date-helpers";
import { daysBetween } from "@/utils/metric-points";
import type { BlockDateChange, ClientBlock } from "@/types/client-blocks";

// Pure chain math for journey blocks — client-safe, UTC-anchored end to end
// (string day arithmetic via addDaysToDateString; never `new Date(x +
// "T00:00:00")`, which parses server-local and can duplicate or skip a date
// across a DST boundary).
//
// Durations in, dates out: `ends_on = starts_on + weeks*7 − 1`, the next
// block's `starts_on = ends_on + 1`, so overlaps and gaps are unexpressible.
// The delete shift lives here too so the coach UI's confirm dialog computes
// its consequence sentence with the same function the service executes — the
// lib/daily-log-permissions.ts one-rule-both-sides precedent.

export const DAYS_PER_BLOCK_WEEK = 7;

export interface BlockWindow {
  startsOn: string;
  endsOn: string;
}

/** Walk a duration list from an anchor date into contiguous windows. */
export function computeBlockChain(anchor: string, weeks: number[]): BlockWindow[] {
  const windows: BlockWindow[] = [];
  let startsOn = anchor;
  for (const blockWeeks of weeks) {
    const endsOn = addDaysToDateString(startsOn, blockWeeks * DAYS_PER_BLOCK_WEEK - 1);
    windows.push({ startsOn, endsOn });
    startsOn = addDaysToDateString(endsOn, 1);
  }
  return windows;
}

/** Whole days in [startsOn, endsOn], both ends included. */
export function inclusiveDays(startsOn: string, endsOn: string): number {
  return daysBetween(startsOn, endsOn) + 1;
}

/**
 * Weeks a window spans — ceil, so a truncated block reports the week it
 * reached (29 days → 5, matching the "week 5 of 6" the coach saw on its final
 * day). Equals the authored count whenever the day count is a multiple of 7,
 * which is every untruncated block. Shared by the GET's `weeks` field and
 * `weekOfTotal.total`: one derivation, no second solver.
 */
export function weeksSpanned(startsOn: string, endsOn: string): number {
  return Math.ceil(inclusiveDays(startsOn, endsOn) / DAYS_PER_BLOCK_WEEK);
}

export type DeleteShiftOutcome =
  | { kind: "elapsed" }
  | { kind: "removed" | "truncated"; changes: BlockDateChange[] };

/**
 * What deleting a block does to the chain. Returns null for an id not in the
 * chain; `{ kind: "elapsed" }` for a read-only past block.
 *
 * - Future block → the row is removed and subsequent blocks shift back by the
 *   full deleted duration (workstream invariant 8, literally).
 * - Current block, mid-flight → TRUNCATE at yesterday: the row stays, its
 *   lived days stay attributed (invariant 3 — no gap), and the next block
 *   starts today. "Shifts, never wipes": subsequent blocks move back by
 *   exactly the removed remainder.
 * - Current block on its own first day → removed (zero lived days, so removal
 *   creates no gap; truncating would invert the window).
 *
 * Both cases re-anchor the subsequent chain at max(deleted.startsOn, today) —
 * one expression, both behaviours.
 */
export function computeDeleteShift(
  chain: ClientBlock[],
  deletedId: string,
  today: string
): DeleteShiftOutcome | null {
  const index = chain.findIndex((block) => block.id === deletedId);
  if (index === -1) return null;
  const deleted = chain[index];

  if (deleted.endsOn < today) return { kind: "elapsed" };

  const truncates = deleted.startsOn < today;
  const changes: BlockDateChange[] = [];

  if (truncates) {
    changes.push({
      id: deleted.id,
      name: deleted.name,
      previous: { startsOn: deleted.startsOn, endsOn: deleted.endsOn },
      next: { startsOn: deleted.startsOn, endsOn: addDaysToDateString(today, -1) },
    });
  }

  let cursor = truncates ? today : deleted.startsOn;
  for (const block of chain.slice(index + 1)) {
    const days = inclusiveDays(block.startsOn, block.endsOn);
    const next = {
      startsOn: cursor,
      endsOn: addDaysToDateString(cursor, days - 1),
    };
    if (next.startsOn !== block.startsOn || next.endsOn !== block.endsOn) {
      changes.push({
        id: block.id,
        name: block.name,
        previous: { startsOn: block.startsOn, endsOn: block.endsOn },
        next,
      });
    }
    cursor = addDaysToDateString(next.endsOn, 1);
  }

  return { kind: truncates ? "truncated" : "removed", changes };
}
