import { addDaysToDateString } from "@/lib/date-helpers";

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
 */
export function chainPhases(
  startDate: string,
  phases: PhaseLengthInput[]
): ChainedPhase[] {
  const chained: ChainedPhase[] = [];
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

/** The last day any block reaches, or null when there are no blocks. */
export function lastPhaseEnd(phases: DatedPhase[]): string | null {
  let latest: string | null = null;
  for (const phase of phases) {
    if (latest === null || phase.endsOn > latest) latest = phase.endsOn;
  }
  return latest;
}
