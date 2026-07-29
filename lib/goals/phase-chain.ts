import { addDaysToDateString, dateStringToDayNumber } from "@/lib/date-helpers";

/**
 * Pure block-chain arithmetic: durations in, dates out (execution-plan invariant 6).
 *
 * The coach enters a start date plus a list of lengths in weeks; the chain is
 * computed. Overlaps and gaps are therefore structurally impossible, which is why
 * there is no overlap validation anywhere in this workstream and no unique index
 * on (client_id, starts_on).
 *
 * Browser-safe and synchronous — Session 3's goal panel renders the live
 * "15 weeks - 4 Aug to 16 Nov" readout from these same functions, so the coach's
 * preview and the server's write cannot disagree about where a block lands.
 * Date arithmetic goes through `addDaysToDateString` (UTC-anchored) rather than
 * `Date` math, for the reason task 1.4 documented: a parse-UTC/format-local mix
 * silently loses a day west of UTC.
 */

export type PhaseLengthInput = {
  name: string;
  weeks: number;
  ratePerWeekKg: number;
  /** Present when editing an existing block; absent for a new one. */
  id?: string;
};

export type ChainedPhase = PhaseLengthInput & {
  startsOn: string;
  endsOn: string;
};

/** Anything carrying a block's date window — the phase row, or a chained input. */
export type DatedPhase = {
  startsOn: string;
  endsOn: string;
};

const DAYS_PER_WEEK = 7;

/**
 * Lay a list of block lengths onto the calendar from `startDate`.
 *
 * Each block runs `weeks * 7` days and the next begins the following day, so the
 * chain is contiguous by construction. A block of N weeks starting on D ends on
 * D + (N*7 - 1): the end date is INCLUSIVE, matching how `expandDateRange` and
 * `calculatePlacementEndDate` treat a window elsewhere in this codebase.
 *
 * Generic over the row because `weeks` is the only field it reads: the server
 * chains rows carrying `ratePerWeekKg`, while the coach's live preview chains
 * rows whose rate is in the client's DISPLAY unit. Everything else rides through
 * untouched, so neither caller has to fabricate a field to satisfy a type.
 */
export function chainPhases<T extends { weeks: number }>(
  startDate: string,
  phases: T[]
): Array<T & { startsOn: string; endsOn: string }> {
  const chained: Array<T & { startsOn: string; endsOn: string }> = [];
  let cursor = startDate;

  for (const phase of phases) {
    const startsOn = cursor;
    const endsOn = addDaysToDateString(startsOn, phase.weeks * DAYS_PER_WEEK - 1);
    chained.push({ ...phase, startsOn, endsOn });
    cursor = addDaysToDateString(endsOn, 1);
  }

  return chained;
}

/**
 * The block covering `date`, or null when the date sits outside every block.
 *
 * Pure and list-based on purpose. The per-date nutrition resolver calls this once
 * per generated date, so a DB round trip here would be a query inside a per-item
 * loop — the shape CONVENTIONS section 2 forbids. Callers load the client's blocks
 * once and pass the array.
 *
 * The predicate mirrors `coversDate` (services/training-plan-window.ts), but
 * blocks have a closed window: a block always has an end, so there is no
 * `endsOn IS NULL` half to handle.
 */
export function getPhaseForDate<T extends DatedPhase>(
  phases: T[],
  date: string
): T | null {
  for (const phase of phases) {
    if (phase.startsOn <= date && date <= phase.endsOn) return phase;
  }
  return null;
}

/**
 * A block is elapsed once the client's today is past its last day.
 *
 * Elapsed blocks are read-only (invariant 9) — the same rule the amendment
 * surface applies to elapsed training slots. `clientToday` is the CLIENT's
 * calendar date, never the server's or the coach's device date.
 */
export function isPhaseElapsed(phase: DatedPhase, clientToday: string): boolean {
  return phase.endsOn < clientToday;
}

/**
 * Inclusive-window length in whole weeks — the inverse of {@link chainPhases},
 * which only ever produces multiples of 7.
 *
 * Lives here rather than in `services/client-phases-service.ts` because the
 * coach's panel has to run it too: it seeds each stored row's `weeks` in order
 * to resubmit the chain, and the server then validates elapsed blocks against
 * the dates `chainPhases` COMPUTES from those weeks. A second copy in the
 * browser would be a second copy of this arithmetic, which is exactly what task
 * 2.3 had to undo once already (it hand-rolled `Date.UTC` here and a local-parse
 * variant loses a day west of UTC). One function, both callers.
 *
 * Rounding is lossy for a window that is not a whole number of weeks — see
 * {@link isConformingChain}, which is how callers refuse such data rather than
 * silently re-dating it.
 */
export function weeksBetween(startsOn: string, endsOn: string): number {
  const days = dateStringToDayNumber(endsOn) - dateStringToDayNumber(startsOn);
  return Math.round((days + 1) / DAYS_PER_WEEK);
}

/**
 * Could `chainPhases` have produced this list?
 *
 * True when every block spans a whole number of weeks AND each one starts the
 * day after its predecessor ends. Through the app this is always true — the PUT
 * sends lengths and the service chains them, and `writePhaseDailyTargets`
 * re-reads each row's existing dates rather than recomputing them — so a false
 * answer means the rows were written by hand.
 *
 * It matters because `weeksBetween` ROUNDS. A hand-written 10-day block derives
 * as 1 week and would be re-chained 3 days shorter; an 11-day one derives as 2
 * and would grow; a gap between two blocks would be closed, silently changing
 * what the client eats on the uncovered dates (a date in no block falls back to
 * the plan's own grid). Every one of those also nulls the affected blocks'
 * generated grids via `carryDailyTargets`. Callers therefore REFUSE a
 * non-conforming chain instead of normalizing it — normalizing writes the drift,
 * and if the drifted block has already elapsed the server's 422 makes the edit
 * unrecoverable from a UI that has no way to express the original dates.
 */
export function isConformingChain(phases: DatedPhase[]): boolean {
  for (let i = 0; i < phases.length; i += 1) {
    const phase = phases[i];
    const span =
      dateStringToDayNumber(phase.endsOn) - dateStringToDayNumber(phase.startsOn) + 1;
    if (span <= 0 || span % DAYS_PER_WEEK !== 0) return false;

    const previous = phases[i - 1];
    if (previous && phase.startsOn !== addDaysToDateString(previous.endsOn, 1)) {
      return false;
    }
  }
  return true;
}

/** The last day any block reaches, or null when there are no blocks. */
export function lastPhaseEnd(phases: DatedPhase[]): string | null {
  let latest: string | null = null;
  for (const phase of phases) {
    if (latest === null || phase.endsOn > latest) latest = phase.endsOn;
  }
  return latest;
}
