import { getTrend } from "@/utils/metric-shaping";
import { toneFor, type Tone } from "@/utils/metric-derived-stats";
import type { MeasurementKey, MeasurementSource } from "@/lib/measurements/keys";

/**
 * The rows of the coach's measurement log: ONE ROW PER DAY per metric — the
 * reading in force, rule 2's winner among the day's live rows — with the
 * day's other readings FOLDED beneath it. A coach who corrected a check-in's
 * 91 kg to 90 sees one row reading 90 with the 91 folded under it as
 * corrected; two genuine readings of one day, the client's home weigh-in
 * under the coach's clinic one, fold as also logged; a removed reading folds
 * as removed, with who removed it and when, so it can be restored. A day
 * whose readings are ALL removed is itself a muted row, led by its newest
 * removed reading. Nothing is hidden and nothing is lost: the store appends,
 * and the list shows the result rather than the mechanism
 * (docs/MEASUREMENT-LOG-PLAN.md §6 commit 7, D21).
 *
 * The chart and every figure above the log read the day-values, so this
 * builder takes both: the readings for the rows, the day-values for which
 * reading stands and what the day changed against (the previous DAY's
 * standing value).
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

/**
 * Why a folded reading is not the day's value (D21): `corrected` when it
 * carries the standing reading's check-in stamp — the store records a
 * correction of a STAMPED reading and nothing else, so a coach's edit of
 * their own unstamped entry and a second coach reading on one day are the
 * same two rows and both read `also`; `removed` when it has been removed.
 */
export type FoldKind = "corrected" | "also" | "removed";

type MeasurementLogRowBase = {
  /** The measurement row's id. */
  id: string;
  date: string;
  metricId: MeasurementKey;
  value: number;
  canonicalValue: number;
  /** Against the previous day's standing value; null on a folded reading, a removed row or a first reading. */
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

/** A reading folded under the day's row. */
export type FoldedMeasurementLogRow = MeasurementLogRowBase & { kind: FoldKind };

export type MeasurementLogRow = MeasurementLogRowBase & {
  /** The day's other readings, newest write first. */
  folded: FoldedMeasurementLogRow[];
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

/** The day-value dated exactly `date`, if the day has a standing value. */
function dayValueOn(
  days: readonly MeasurementDayValueInput[],
  date: string
): MeasurementDayValueInput | null {
  const at = lowerBound(days, date);
  return at < days.length && days[at].date === date ? days[at] : null;
}

/** Newest write first; the id breaks an equal instant so two readers agree. */
function byNewestWrite(a: MeasurementLogReadingInput, b: MeasurementLogReadingInput): number {
  if (a.recordedAt !== b.recordedAt) return a.recordedAt < b.recordedAt ? 1 : -1;
  return a.id < b.id ? 1 : -1;
}

export function buildMeasurementLogRows(
  readings: readonly MeasurementLogReadingInput[],
  dayValues: ReadonlyMap<MeasurementKey, readonly MeasurementDayValueInput[]>,
  baselineIds: Partial<Record<MeasurementKey, string>>,
  order: readonly MeasurementKey[],
  downIsGood: ReadonlySet<string>
): MeasurementLogRow[] {
  const rank = new Map(order.map((key, index) => [key, index]));

  const toBase = (
    reading: MeasurementLogReadingInput,
    days: readonly MeasurementDayValueInput[],
    previous: MeasurementDayValueInput | null
  ): MeasurementLogRowBase => {
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
    };
  };

  // One group per (metric, day).
  const groups = new Map<string, MeasurementLogReadingInput[]>();
  for (const reading of readings) {
    const key = `${reading.metricKey}|${reading.date}`;
    const group = groups.get(key);
    if (group) group.push(reading);
    else groups.set(key, [reading]);
  }

  const rows: Array<MeasurementLogRow & { rank: number }> = [];
  for (const group of groups.values()) {
    const { metricKey, date } = group[0];
    const days = dayValues.get(metricKey) ?? [];
    const newestFirst = [...group].sort(byNewestWrite);
    const live = newestFirst.filter((reading) => !reading.voided);
    // The reading in force is the day-value's row. A day with no live reading
    // is led by its newest removed one, so the coach can see it and restore it.
    const standingId = dayValueOn(days, date)?.id ?? null;
    const lead = live.find((reading) => reading.id === standingId) ?? live[0] ?? newestFirst[0];
    const previous = lead.voided ? null : previousDayValue(days, date);

    const folded: FoldedMeasurementLogRow[] = newestFirst
      .filter((reading) => reading.id !== lead.id)
      .map((reading) => ({
        ...toBase(reading, days, null),
        kind: reading.voided
          ? "removed"
          : reading.sourceId != null && reading.sourceId === lead.sourceId
            ? "corrected"
            : "also",
      }));

    rows.push({
      ...toBase(lead, days, previous),
      folded,
      rank: rank.get(metricKey) ?? order.length,
    });
  }

  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1; // date DESC
    if (a.rank !== b.rank) return a.rank - b.rank; // tab order
    return a.id < b.id ? 1 : -1;
  });

  return rows.map(({ rank: _rank, ...row }) => row);
}
