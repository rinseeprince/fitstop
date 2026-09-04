import { daysBetween } from "@/utils/metric-points";

// Pure chain math for journey blocks — client-safe, UTC-anchored end to end
// (string day arithmetic via addDaysToDateString; never `new Date(x +
// "T00:00:00")`, which parses server-local and can duplicate or skip a date
// across a DST boundary).
//
// A block owns its own window (migration 164): the coach picks both dates, gaps
// between blocks are a real state (nothing is planned) and overlaps are refused
// by the service and by a database constraint. What is left here is the span
// arithmetic every surface shares.

export const DAYS_PER_BLOCK_WEEK = 7;

interface BlockWindow {
  startsOn: string;
  endsOn: string;
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
