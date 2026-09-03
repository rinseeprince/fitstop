import { getTrend } from "@/utils/metric-shaping";
import { toneFor, type Tone } from "@/utils/metric-derived-stats";
import type { MeasurementKey, MeasurementSource } from "@/lib/measurements/keys";

/**
 * The rows of the coach's measurement log: ONE ROW PER READING, newest day
 * first and within a day the most recently written first. A coach who edited
 * a check-in's 91 kg to 90 sees one row reading 90 — the same row, changed in
 * place, in the same place; two readings on one day are two rows, because
 * two were added; a removed reading is a muted row with who removed it and
 * when, so it can be restored. Nothing beneath a row, no count beside a value
 * (docs/MEASUREMENT-LOG-PLAN.md §6 commit 8, D23).
 *
 * The chart and every figure above the log read the day-values, so this
 * builder takes both: the readings for the rows, the day-values for which
 * reading is the day's standing value and what a day changed against — the
 * previous DAY's standing value, which every live row of a day measures
 * against.
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
  /** When the row was written — orders a day's rows; an edit never moves one. */
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
  /** Against the previous day's standing value; null on a removed row or a first day. */
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

/** The index of the first day-value dated on or after `date`, by binary search. */
function lowerBound(days: readonly MeasurementDayValueInput[], date: string): number {
  let lo = 0;
  let hi = days.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid].date < date) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The last day-value dated strictly before `date`. */
function previousDayValue(
  days: readonly MeasurementDayValueInput[],
  date: string
): MeasurementDayValueInput | null {
  const at = lowerBound(days, date);
  return at > 0 ? days[at - 1] : null;
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
    // A removed reading is in no figure, so it measures against nothing.
    const previous = reading.voided ? null : previousDayValue(days, reading.date);
    const trend = getTrend(reading.value, previous?.value ?? null);
    const row: MeasurementLogRow = {
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
    };
    return { row, rank: rank.get(reading.metricKey) ?? order.length, recordedAt: reading.recordedAt };
  });

  rows.sort((a, b) => {
    if (a.row.date !== b.row.date) return a.row.date < b.row.date ? 1 : -1; // date DESC
    if (a.rank !== b.rank) return a.rank - b.rank; // tab order
    // Within a day, the most recently written first; the id breaks an equal
    // instant so two readers agree.
    if (a.recordedAt !== b.recordedAt) return a.recordedAt < b.recordedAt ? 1 : -1;
    return a.row.id < b.row.id ? 1 : -1;
  });

  return rows.map((entry) => entry.row);
}
