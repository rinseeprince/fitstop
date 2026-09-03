import { WELLNESS_KEYS, type WellnessKey } from "./keys";

/**
 * The day's value for a wellness metric (docs/MEASUREMENT-LOG-PLAN.md §6
 * commit 7, D16): the client's own daily log, one row per day — a non-null
 * column is that day's reading, a null column no reading of that metric that
 * day. There is one source, because a wellness score is the client's
 * self-report (D18), so there is no merge and no tie rule.
 *
 * `wellness_logs` holds ONE row per client and day (the spine is unique on
 * client and date, the wellness row on its spine id), and the client's write
 * upserts that row: editing or backfilling a day changes its row in place and
 * keeps its date. So nothing here orders by write time — every list ascends
 * by `date`, and a row's `updatedAt` only rides along as `recordedAt` for the
 * point's sort key downstream.
 *
 * Pure and isomorphic, like `lib/measurements/day-values.ts`, with two
 * callers: the coach's series service and the client's progress read, so
 * both apps derive the same day from the same rows. No date-fns: `date` is
 * YYYY-MM-DD on the client's calendar.
 */

/** One day of the client's log — the `wellness_logs` row. */
export type WellnessLogDay = {
  id: string;
  /** YYYY-MM-DD, the client's calendar day. */
  date: string;
  /** The row's last write — any of the five fields moves it. */
  updatedAt: string;
} & Record<WellnessKey, number | null>;

/** The reading standing for one day of one metric. */
export type WellnessDayValue = {
  metricKey: WellnessKey;
  date: string;
  value: number;
  /** The `wellness_logs` row's id. */
  id: string;
  /** The row's last write. */
  recordedAt: string;
};

function later(standing: WellnessDayValue, candidate: WellnessDayValue): WellnessDayValue {
  // Two rows for one day cannot come from the store (one row per client and
  // day); decide deterministically all the same, so two readers of the same
  // rows agree: the later write, then the id.
  if (standing.recordedAt !== candidate.recordedAt) {
    return candidate.recordedAt > standing.recordedAt ? candidate : standing;
  }
  return candidate.id > standing.id ? candidate : standing;
}

/**
 * The client's log rows as one value per (metric, day), ascending by day
 * within each metric. Every one of the five metrics is present, empty when no
 * row carries a reading of it. Input order does not matter.
 */
export function wellnessDayValues(
  logs: readonly WellnessLogDay[]
): Map<WellnessKey, WellnessDayValue[]> {
  const winners = new Map<WellnessKey, Map<string, WellnessDayValue>>();
  for (const log of logs) {
    for (const metricKey of WELLNESS_KEYS) {
      const value = log[metricKey];
      if (value == null) continue; // no reading of this metric that day
      let days = winners.get(metricKey);
      if (!days) {
        days = new Map();
        winners.set(metricKey, days);
      }
      const candidate: WellnessDayValue = {
        metricKey,
        date: log.date,
        value,
        id: log.id,
        recordedAt: log.updatedAt,
      };
      const standing = days.get(log.date);
      days.set(log.date, standing ? later(standing, candidate) : candidate);
    }
  }

  const out = new Map<WellnessKey, WellnessDayValue[]>();
  for (const metricKey of WELLNESS_KEYS) {
    const days = winners.get(metricKey);
    out.set(
      metricKey,
      days
        ? [...days.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
        : []
    );
  }
  return out;
}
