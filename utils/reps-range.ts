// One-input rep schemes for the set-row editor: the reps column's bounds over
// the shared range grammar (utils/target-range.ts), kept under its own name
// because every reps reader spells it this way.
//
// Bounds mirror setSpecSchema (reps 0-100, integer) so the client-side
// safeParse belt never trips on a value this module produced.

import {
  formatTargetRange,
  parseTargetRange,
  type TargetRange,
  type TargetRangeBounds,
} from "./target-range";

export type RepsRange = TargetRange;

const REPS_RANGE_BOUNDS: TargetRangeBounds = {
  floor: 0,
  ceiling: 100,
  integer: true,
};

/**
 * The string shown in the Reps box for a stored range.
 *
 * A single number means min === max — the same collapse `setsRepsShort` already
 * applies to session-card summaries, so the editor and the card agree.
 */
export function formatRepsRange(range: RepsRange): string {
  return formatTargetRange(range);
}

/**
 * Parse what the coach typed, or `null` when it is not a rep scheme — the
 * caller reverts the input and writes nothing.
 */
export function parseRepsRange(raw: string): RepsRange | null {
  return parseTargetRange(raw, REPS_RANGE_BOUNDS);
}
