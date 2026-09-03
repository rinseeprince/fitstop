import type { MeasurementKey, MeasurementSource } from "./keys";

/**
 * Rule 2 of the measurement log (docs/MEASUREMENT-LOG-PLAN.md §2, D23): the
 * value for a day is the reading written or edited LAST — the latest live row
 * for that client, metric and day by `updated_at`, a tie broken by id. One
 * rule, no source ranking, no tie-break table: the coach editing after the
 * check-in wins because the edit is the day's last touch, and a reading added
 * after that edit wins in turn.
 *
 * Pure, so the server's series, the portal's progress read and any browser
 * caller derive the same day from the same rows. No date-fns: `date` is
 * YYYY-MM-DD on the client's calendar and `updatedAt` is an ISO instant, and
 * ISO instants compare correctly as strings only when they share an offset —
 * PostgREST emits every timestamptz in one offset, so they do.
 */
export type MeasurementReading = {
  id: string;
  metricKey: MeasurementKey;
  value: number;
  /** YYYY-MM-DD, the client's calendar day the reading belongs to. */
  date: string;
  /** When the row was written. */
  recordedAt: string;
  /** When the value was last written or edited — what decides the day. */
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
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  // Two touches in the same instant: pick deterministically rather than by
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
