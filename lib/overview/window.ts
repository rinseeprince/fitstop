/**
 * The window the Overview's Signals card reads.
 *
 * Fourteen days, and not selectable. Signals answers "where is this client at",
 * which is a glance — 30 and 60 turned it into an analysis surface and buried
 * the last fortnight, the part a coach acts on, inside a quarter of history.
 * The Journey tab keeps the long ranges, which is where a long question
 * belongs.
 *
 * The progression chart above it is deliberately NOT on this window: it shows
 * the client's whole journey (`services/measurement-series-service.ts`). One
 * page, two timescales, each stated where it is rendered.
 */

export const SIGNALS_WINDOW_DAYS = 14;

/** Divider-rail meta. Number-bearing, so the call site renders it mono. */
export function signalsWindowLabel(days: number = SIGNALS_WINDOW_DAYS): string {
  return `Last ${days} days`;
}
