import type { MeasurementKey, MeasurementSource } from "./keys";

/**
 * Rule 2 of the measurement log (docs/MEASUREMENT-LOG-PLAN.md §2, D23): the
 * value for a day is the reading WRITTEN last — the latest live row for that
 * client, metric and day by `recorded_at`, a tie broken by id. One rule, no
 * source ranking, no tie-break table: the coach logging after the check-in
 * wins. An edit changes a reading's value and nothing else — `recorded_at`
 * is set once, so no edit can reorder a day or make an older reading the
 * day's value; a coach who wants a different number to stand logs a new
 * reading. `updated_at` records the edit and orders nothing.
 *
 * Pure, so the server's series, the portal's progress read and any browser
 * caller derive the same day from the same rows. No date-fns: `date` is
 * YYYY-MM-DD on the client's calendar and `recordedAt` is an ISO instant, and
 * ISO instants compare correctly as strings only when they share an offset —
 * PostgREST emits every timestamptz in one offset, so they do.
 */
export type MeasurementReading = {
  id: string;
  metricKey: MeasurementKey;
  value: number;
  /** YYYY-MM-DD, the client's calendar day the reading belongs to. */
  date: string;
  /** When the row was written. Set once; decides the day. */
  recordedAt: string;
  /** When the value was last written or edited. Records the edit; orders nothing. */
  updatedAt: string;
  measuredAt: string | null;
  source: MeasurementSource;
  sourceId: string | null;
  note: string | null;
};

/** The reading standing for one day of one metric — a `MeasurementReading`
 *  that won its day. Same shape, named for what it means. */
export type DayValue = MeasurementReading;

function later(a: MeasurementReading, b: MeasurementReading): MeasurementReading {
  if (a.recordedAt !== b.recordedAt) return a.recordedAt > b.recordedAt ? a : b;
  // Two writes in the same instant: pick deterministically rather than by
  // arrival order, so two readers of the same rows agree.
  return a.id > b.id ? a : b;
}

/**
 * Collapse readings to one per (metric, day), ascending by day within each
 * metric. Input order does not matter.
 */
export function dayValues(
  readings: readonly MeasurementReading[]
): Map<MeasurementKey, DayValue[]> {
  const winners = new Map<MeasurementKey, Map<string, MeasurementReading>>();
  for (const reading of readings) {
    let days = winners.get(reading.metricKey);
    if (!days) {
      days = new Map();
      winners.set(reading.metricKey, days);
    }
    const standing = days.get(reading.date);
    days.set(reading.date, standing ? later(standing, reading) : reading);
  }

  const out = new Map<MeasurementKey, DayValue[]>();
  for (const [metricKey, days] of winners) {
    out.set(
      metricKey,
      [...days.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    );
  }
  return out;
}
