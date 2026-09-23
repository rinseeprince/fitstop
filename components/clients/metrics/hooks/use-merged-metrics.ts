"use client";

import { useMemo } from "react";
import { useClientGoals } from "@/hooks/use-client-goals";
import { useMeasurementSeries } from "@/hooks/use-measurement-series";
import { useWellnessSeries } from "@/hooks/use-wellness-series";
import { getTodayDateString } from "@/lib/date-helpers";
import { DOWN_IS_GOOD } from "@/lib/metrics/metric-entry-definitions";
import type { MeasurementKey } from "@/lib/measurements/keys";
import type { WellnessKey } from "@/lib/wellness/keys";
import { resolveEffectiveGoal } from "@/lib/goals/resolve-effective-goal";
import { goalProgressChip } from "@/lib/goals/goal-chip";
import type { GoalMetric } from "@/lib/goals/goal-types";
import type { MetricPoint } from "@/utils/metric-points";
import { buildMeasurementLogRows } from "@/utils/measurement-log-rows";
import {
  buildLogRows,
  compareLastDays,
  deriveFirstWeekChange,
  deriveHeroStats,
  WINDOW_DAYS,
  worstOfLastDays,
  type HeroBaseline,
} from "@/utils/metric-derived-stats";
import {
  BODY_METRIC_DEFINITIONS,
  WELLNESS_METRIC_DEFINITIONS,
  type MetricDefinition,
} from "./use-metrics-data";
import { useUnits } from "@/contexts/units-context";
import { formatLength, formatWeight, type UnitSystem } from "@/utils/unit-conversions";
import {
  cardThreeKind,
  type CardThree,
  type GoalCard,
  type LogRow,
  type MetricSummary,
} from "../metrics-view-types";
import type { Client } from "@/types/check-in";
import type { MeasurementSeriesPoint, WellnessSeriesPoint } from "@/types/coach-overview";

/**
 * The Journey's two metric panes read two stores, and each pane reads its own
 * alone — the hook below it is the only one it calls, so a pane never loads
 * what another shows:
 *
 *  - PHYSIQUE (the seven body measurements) reads the measurement log's
 *    day-values through the series route — one value per day, of any source,
 *    with the baseline (the reading as of the start date) beside it — and the
 *    goal. Readings dated before the start date are listed under "Before
 *    start" and kept out of the chart and every derived figure.
 *  - WELLNESS (the five scores) reads the client's own daily log through the
 *    wellness series route — one value per day, from one source: a wellness
 *    score is the client's self-report, so its log rows carry no action.
 *
 * The figures wait for the series: the cards' windows end on the client's
 * today (D30), which the series carries.
 */

// Stored values are canonical kg/cm and are converted HERE, at the point the
// series is built, rather than at each of the render sites downstream. Every
// derived figure — the hero, the cards' averages, the distance to the goal —
// is computed from these points, so converting at source is what keeps a
// delta consistent with the two numbers it sits between.
// Rounded to one decimal, deliberately. A converted value carries the full
// float — 170 kg is 374.78584571429193 lbs — and metric-hero renders
// `latest.value` raw, so an imperial coach saw fifteen decimal places where a
// metric one saw "170". One decimal is also what every other figure on the card
// already shows (total change, the cards' averages, goal), so this makes the
// hero consistent with them rather than introducing a new precision.
const round1 = (n: number): number => Math.round(n * 10) / 10;

const convertPoint = (value: number, kind: MetricDefinition["convert"], viewer: UnitSystem) =>
  kind === "weight"
    ? round1(formatWeight(value, viewer).value)
    : kind === "length"
      ? round1(formatLength(value, viewer).value)
      : value;

// Method bivariance makes the narrow ReadonlySet<MeasurementKey | WellnessKey>
// usable where plain string ids are looked up.
const DOWN_SET: ReadonlySet<string> = DOWN_IS_GOOD;

/** A series route's points as the page's point shape — one per day already. */
function seriesPoints(
  points: readonly (MeasurementSeriesPoint | WellnessSeriesPoint)[] | undefined,
  key: MeasurementKey | WellnessKey
): MetricPoint[] {
  return (points ?? []).map((point) => ({
    metricId: key,
    value: point.value,
    date: point.date,
    sortKey: `${point.date}|${point.recordedAt}|${point.id}`,
    sourceRecordId: point.id,
  }));
}

/** What a metric pane renders: its metrics, and its measurement log's rows. */
export type MetricPaneData = {
  /** One summary per metric of the pane once its series has landed; none before. */
  metrics: MetricSummary[];
  logRows: LogRow[];
  isLoading: boolean;
  isError: boolean;
};

const NO_PANE_DATA: Pick<MetricPaneData, "metrics" | "logRows"> = { metrics: [], logRows: [] };

/** No wellness score is a goal metric, so a wellness card 3 never reads this. */
const NO_GOAL_CARD: GoalCard = { status: "none" };

const isGoalMetric = (id: string): id is GoalMetric => id === "weight" || id === "bodyFat";

/** Card 3, as the metric's kind decides (D31). */
function buildCardThree(
  metricId: string,
  points: MetricPoint[],
  clientToday: string,
  goal: GoalCard
): CardThree {
  const kind = cardThreeKind(metricId);
  switch (kind) {
    case "goal":
      return { kind, goal };
    case "last90":
      return {
        kind,
        comparison: compareLastDays(points, clientToday, WINDOW_DAYS.girth, DOWN_SET.has(metricId)),
      };
    case "lowest":
    case "highest":
      return { kind, worst: worstOfLastDays(points, clientToday, WINDOW_DAYS.month, kind === "highest") };
  }
}

/**
 * A metric's summary off its points — the figures its hero, cards, chart and
 * log read. The cards are every metric's; the Total change and the goal are
 * the pane's own.
 */
function summariseMetric(
  def: MetricDefinition,
  points: MetricPoint[],
  hero: ReturnType<typeof deriveHeroStats>,
  clientToday: string,
  viewer: UnitSystem,
  own: { totalChange: MetricSummary["totalChange"]; goal: number | null; goalCard: GoalCard }
): MetricSummary {
  const downIsGood = DOWN_SET.has(def.id);
  return {
    id: def.id,
    name: def.name,
    tab: def.category,
    unit: def.getUnit(viewer),
    points,
    latest: hero?.current ?? null,
    first: points.length ? { value: points[0].value, date: points[0].date } : null,
    entryCount: points.length,
    totalChange: own.totalChange,
    startsOn: hero?.startsOn ?? null,
    avgRate: hero?.avgRate ?? null,
    lastWeek: compareLastDays(points, clientToday, WINDOW_DAYS.week, downIsGood),
    lastMonth: compareLastDays(points, clientToday, WINDOW_DAYS.month, downIsGood),
    cardThree: buildCardThree(def.id, points, clientToday, own.goalCard),
    goal: own.goal,
  };
}

/** The Physique pane: the measurement series and the goal, nothing else. */
export const usePhysiqueMetrics = (client: Client): MetricPaneData => {
  const { series, isLoading, isError } = useMeasurementSeries(client.id);
  const {
    current: currentGoal,
    isLoading: goalLoading,
    isError: goalFailed,
  } = useClientGoals(client.id);
  const { preference } = useUnits();

  const { metrics, logRows } = useMemo(() => {
    if (!series) return NO_PANE_DATA;
    // The hero's "logged today" and `Starts …` count from the device's day;
    // the cards' windows end on the client's.
    const today = getTodayDateString();
    const { clientToday } = series;
    // The route's start date is the same column the client record carries;
    // the record's covers a series read before the date was set.
    const startDate = series.startDate ?? client.startDate ?? null;
    const pointsByMetric = new Map(
      BODY_METRIC_DEFINITIONS.map((def) => [
        def.id,
        seriesPoints(series[def.id], def.id).map((p) => ({
          ...p,
          value: convertPoint(p.value, def.convert, preference),
        })),
      ])
    );

    // The goal in force on the client's today, resolved as the server's goal
    // readers resolve it. A weight target is canonical kilograms; it converts
    // the way the series did, so its distance to a reading is taken between
    // two like numbers.
    const effectiveGoal = resolveEffectiveGoal(currentGoal);
    const targetFor = (id: MeasurementKey): number | null =>
      id === "weight" && effectiveGoal.goalWeightKg != null
        ? round1(formatWeight(effectiveGoal.goalWeightKg, preference).value)
        : id === "bodyFat"
          ? effectiveGoal.goalBodyFatPercentage
          : null;
    // "No target" is a claim about the goal read, so it waits for the read. A
    // target's distance is said as the goal card on the Overview says it
    // (`goalProgressChip`), judged from the reading on the goal's start day.
    const goalCardFor = (
      def: MetricDefinition<MeasurementKey>,
      target: number | null,
      newest: number | null
    ): GoalCard => {
      if (goalLoading) return { status: "pending" };
      if (goalFailed) return { status: "failed" };
      if (target == null || !isGoalMetric(def.id)) return { status: "none" };
      const start = currentGoal?.startReadings[def.id] ?? null;
      return {
        status: "set",
        target,
        progress: goalProgressChip({
          type: currentGoal?.type,
          metric: def.id,
          start: start == null ? null : convertPoint(start, def.convert, preference),
          current: newest,
          target,
          unit: def.getUnit(preference),
        }),
      };
    };

    const summaries = BODY_METRIC_DEFINITIONS.map((def) => {
      const allPoints = pointsByMetric.get(def.id) ?? [];
      // The journey: a physique reading dated before the start is not a point.
      const points = startDate ? allPoints.filter((p) => p.date >= startDate) : allPoints;
      const raw = series.baseline[def.id] ?? null;
      const baseline: HeroBaseline | null = raw
        ? { value: convertPoint(raw.value, def.convert, preference), date: raw.date, source: raw.source }
        : null;
      const hero = deriveHeroStats(points, "body", today, {
        current: allPoints[allPoints.length - 1] ?? null,
        baseline,
        startDate,
      });

      const target = targetFor(def.id);
      return summariseMetric(def, points, hero, clientToday, preference, {
        totalChange: hero?.totalChange ?? null,
        goal: target,
        goalCard: goalCardFor(def, target, hero?.current.value ?? null),
      });
    });

    // One row per reading — newest day first, within a day the most recently
    // written first, a removed reading with its removal. A row's change is
    // taken against the previous day's standing value, and the chart and the
    // figures above read the day-values (`points`). Values convert here, like
    // the points, so a delta sits between two like numbers; the canonical value
    // rides along for the Edit dialog's seed. Before-start rows are flagged so
    // the section can group them.
    const nameById = new Map(BODY_METRIC_DEFINITIONS.map((d) => [d.id, d.name]));
    const unitById = new Map(BODY_METRIC_DEFINITIONS.map((d) => [d.id, d.getUnit(preference)]));
    const convertBy = new Map(BODY_METRIC_DEFINITIONS.map((d) => [d.id, d.convert]));
    const bodyDayValues = new Map<MeasurementKey, { id: string; date: string; value: number }[]>(
      BODY_METRIC_DEFINITIONS.map((def) => [
        def.id,
        (pointsByMetric.get(def.id) ?? []).map((p) => ({
          id: p.sourceRecordId,
          date: p.date,
          value: p.value,
        })),
      ])
    );
    const baselineIds: Partial<Record<MeasurementKey, string>> = {};
    for (const def of BODY_METRIC_DEFINITIONS) {
      const id = series.baseline[def.id]?.id;
      if (id) baselineIds[def.id] = id;
    }
    const rows: LogRow[] = buildMeasurementLogRows(
      series.readings.map((reading) => ({
        id: reading.id,
        metricKey: reading.metricKey,
        date: reading.date,
        value: convertPoint(reading.value, convertBy.get(reading.metricKey), preference),
        canonicalValue: reading.value,
        source: reading.source,
        sourceId: reading.sourceId,
        note: reading.note,
        recordedAt: reading.recordedAt,
        voided: reading.voided
          ? { at: reading.voided.at, byName: reading.voided.byName }
          : null,
      })),
      bodyDayValues,
      baselineIds,
      BODY_METRIC_DEFINITIONS.map((def) => def.id),
      DOWN_SET
    ).map((row) => ({
      ...row,
      metricName: nameById.get(row.metricId) ?? row.metricId,
      unit: unitById.get(row.metricId) ?? "",
      isMeasurement: true,
      beforeStart: startDate != null && row.date < startDate,
    }));

    return { metrics: summaries, logRows: rows };
    // `preference` is a real dependency: it changes every value in the series,
    // not just the label.
  }, [series, currentGoal, goalLoading, goalFailed, client, preference]);

  return { metrics, logRows, isLoading, isError };
};

/** The Wellness pane: the wellness series — the client's daily log — nothing else. */
export const useWellnessMetrics = (clientId: string): MetricPaneData => {
  const { series, isLoading, isError } = useWellnessSeries(clientId);
  const { preference } = useUnits();

  const { metrics, logRows } = useMemo(() => {
    if (!series) return NO_PANE_DATA;
    // The hero's "logged today" counts from the device's day; the cards'
    // windows and the hero's Total change end on the client's.
    const today = getTodayDateString();
    const { clientToday } = series;
    // A score is unitless: its points are its values as logged
    const pointsByMetric = new Map<string, MetricPoint[]>(
      WELLNESS_METRIC_DEFINITIONS.map((def) => [def.id, seriesPoints(series[def.id], def.id)])
    );

    const summaries = WELLNESS_METRIC_DEFINITIONS.map((def) => {
      const points = pointsByMetric.get(def.id) ?? [];
      return summariseMetric(
        def,
        points,
        deriveHeroStats(points, "wellness", today),
        clientToday,
        preference,
        { totalChange: deriveFirstWeekChange(points, clientToday), goal: null, goalCard: NO_GOAL_CARD }
      );
    });

    // One row per logged day — the client's own log, so no note and no row
    // action.
    const nameById = new Map<string, string>(WELLNESS_METRIC_DEFINITIONS.map((d) => [d.id, d.name]));
    const unitById = new Map<string, string>(
      WELLNESS_METRIC_DEFINITIONS.map((d) => [d.id, d.getUnit(preference)])
    );
    const rows: LogRow[] = buildLogRows(
      pointsByMetric,
      WELLNESS_METRIC_DEFINITIONS,
      "wellness",
      DOWN_SET
    ).map((row) => ({
      ...row,
      metricName: nameById.get(row.metricId) ?? row.metricId,
      unit: unitById.get(row.metricId) ?? "",
      canonicalValue: row.value,
      note: null,
      source: "client_log",
      sourceId: null,
      isMeasurement: false,
      voided: null,
      isCurrent: false,
      isBaseline: false,
      beforeStart: false,
    }));

    return { metrics: summaries, logRows: rows };
  }, [series, preference]);

  return { metrics, logRows, isLoading, isError };
};
