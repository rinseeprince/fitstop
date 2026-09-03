import { getTrend } from "@/utils/metric-shaping";
import { toneFor, type Tone } from "@/utils/metric-derived-stats";
import type { MeasurementKey, MeasurementSource } from "@/lib/measurements/keys";

/**
 * The rows of the coach's measurement log: EVERY reading, not the day's
 * standing value. A check-in's 91 kg is listed under the coach's 90 kg logged
 * the same day; a removed reading stays listed with no change and its
 * removal, so the coach can see it and restore it. The chart and every
 * figure above the log read the day-values instead, so this builder takes
 * both: the readings for the rows, the day-values for what each reading
 * changed against.
 *
 * Pure and unit-agnostic: the caller converts values to the viewer's unit
 * BEFORE building (the same rule as the series points — a delta is taken
 * between two like numbers), and hands the canonical value alongside so the
 * Edit dialog seeds from storage, never from a display rounding.
 */
export type MeasurementLogReadingInput = {
  id: string;
  metricKey: MeasurementKey;
  /** YYYY-MM-DD on the client's calendar. */
  date: string;
  /** In the viewer's unit. */
  value: number;
  /** Canonical kg / cm / %. */
  canonicalValue: number;
  source: MeasurementSource;
  sourceId: string | null;
  note: string | null;
  recordedAt: string;
  voided: { at: string; byName: string | null } | null;
};

/** A day's standing value, in the viewer's unit, ascending by date. */
export type MeasurementDayValueInput = { id: string; date: string; value: number };

type MeasurementLogRow = {
  /** The measurement row's id. */
  id: string;
  date: string;
  metricId: MeasurementKey;
  value: number;
  canonicalValue: number;
  /** Against the previous day's standing value; null on a removed row or a first reading. */
  change: { amount: number; tone: Tone } | null;
  note: string | null;
  source: MeasurementSource;
  sourceId: string | null;
  voided: { at: string; byName: string | null } | null;
  /** The reading every "now" figure uses — the newest day's standing value. */
  isCurrent: boolean;
  /** The reading every "since start" figure uses — the baseline. */
  isBaseline: boolean;
};

/** The last day-value dated strictly before `date`, by binary search. */
function previousDayValue(
  days: readonly MeasurementDayValueInput[],
  date: string
): MeasurementDayValueInput | null {
  let lo = 0;
  let hi = days.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid].date < date) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? days[lo - 1] : null;
}

export function buildMeasurementLogRows(
  readings: readonly MeasurementLogReadingInput[],
  dayValues: ReadonlyMap<MeasurementKey, readonly MeasurementDayValueInput[]>,
  baselineIds: Partial<Record<MeasurementKey, string>>,
  order: readonly MeasurementKey[],
  downIsGood: ReadonlySet<string>
): MeasurementLogRow[] {
  const rank = new Map(order.map((key, index) => [key, index]));

  const rows = readings.map((reading) => {
    const days = dayValues.get(reading.metricKey) ?? [];
    const previous = reading.voided ? null : previousDayValue(days, reading.date);
    const trend = getTrend(reading.value, previous?.value ?? null);
    return {
      id: reading.id,
      date: reading.date,
      metricId: reading.metricKey,
      value: reading.value,
      canonicalValue: reading.canonicalValue,
      change: previous
        ? {
            amount: reading.value - previous.value,
            tone: toneFor(trend, downIsGood.has(reading.metricKey)),
          }
        : null,
      // A coach's note is shown; a check-in or client log carries none the coach wrote.
      note: reading.source === "coach_entry" ? reading.note : null,
      source: reading.source,
      sourceId: reading.sourceId,
      voided: reading.voided,
      isCurrent: days.length > 0 && days[days.length - 1].id === reading.id,
      isBaseline: baselineIds[reading.metricKey] === reading.id,
      rank: rank.get(reading.metricKey) ?? order.length,
      recordedAt: reading.recordedAt,
    };
  });

  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1; // date DESC
    if (a.rank !== b.rank) return a.rank - b.rank; // tab order
    if (a.recordedAt !== b.recordedAt) return a.recordedAt < b.recordedAt ? 1 : -1; // newest write first
    return a.id < b.id ? 1 : -1;
  });

  return rows.map(({ rank: _rank, recordedAt: _recordedAt, ...row }) => row);
}
