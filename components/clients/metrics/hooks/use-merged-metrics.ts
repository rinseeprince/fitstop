"use client";

import { useMemo } from "react";
import { useAllClientCheckIns } from "@/hooks/use-check-in-data";
import { useClientGoals } from "@/hooks/use-client-goals";
import { useMetricEntries } from "@/hooks/use-metric-entries";
import { useMeasurementSeries } from "@/hooks/use-measurement-series";
import { getTodayDateString } from "@/lib/date-helpers";
import { DOWN_IS_GOOD } from "@/lib/metrics/metric-entry-definitions";
import type { MeasurementKey } from "@/lib/measurements/keys";
import {
  resolveEffectiveGoal,
  toClientGoalInput,
} from "@/lib/goals/resolve-effective-goal";
import { buildMetricPoints, type MetricPoint } from "@/utils/metric-points";
import { buildMeasurementLogRows } from "@/utils/measurement-log-rows";
import {
  buildLogRows,
  deriveBest,
  deriveHeroStats,
  deriveWeekComparison,
  deriveWindowChange,
  type HeroBaseline,
} from "@/utils/metric-derived-stats";
import {
  BODY_METRIC_DEFINITIONS,
  WELLNESS_METRIC_DEFINITIONS,
  type MetricDefinition,
} from "./use-metrics-data";
import { useUnits } from "@/contexts/units-context";
import { formatLength, formatWeight, type UnitSystem } from "@/utils/unit-conversions";
import type { LogRow, MetricSummary } from "../metrics-view-types";
import type { Client } from "@/types/check-in";
import type { MeasurementSeries } from "@/types/coach-overview";

/**
 * The Journey's two metric panes read two stores, deliberately (owner decision
 * D2), and each pane reads its own alone — the hook below it is the only one
 * it calls, so a pane never loads what another shows:
 *
 *  - PHYSIQUE (the seven body measurements) reads the measurement log's
 *    day-values through the series route — one value per day, of any source,
 *    with the baseline (the reading as of the start date) beside it — and the
 *    goal. Readings dated before the start date are listed under "Before
 *    start" and kept out of the chart and every derived figure.
 *  - WELLNESS keeps the merge of check-in weekly averages ⊕ coach-logged
 *    client_metric_entries (`buildMetricPoints`, coach entry winning a
 *    same-day tie), because wellness has its own source of truth (daily logs).
 */

// Stored values are canonical kg/cm and are converted HERE, at the point the
// series is built, rather than at each of the six render sites downstream.
// Every derived stat — hero, 30-day change, week comparison, avgRate, best,
// goalToGo — is computed from these points, so converting at source is what
// keeps a delta consistent with the two numbers it sits between.
// Rounded to one decimal, deliberately. A converted value carries the full
// float — 170 kg is 374.78584571429193 lbs — and metric-hero renders
// `latest.value` raw, so an imperial coach saw fifteen decimal places where a
// metric one saw "170". One decimal is also what every other figure on the card
// already shows (total change, 30-day change, goal), so this makes the hero
// consistent with them rather than introducing a new precision.
const round1 = (n: number): number => Math.round(n * 10) / 10;

const convertPoint = (value: number, kind: MetricDefinition["convert"], viewer: UnitSystem) =>
  kind === "weight"
    ? round1(formatWeight(value, viewer).value)
    : kind === "length"
      ? round1(formatLength(value, viewer).value)
      : value;

// Method bivariance makes the narrow ReadonlySet<MetricEntryKey> usable where
// plain string ids are looked up.
const DOWN_SET: ReadonlySet<string> = DOWN_IS_GOOD;

/** The series route's points as the page's point shape — one per day already. */
function seriesPoints(series: MeasurementSeries | null, key: MeasurementKey): MetricPoint[] {
  return (series?.[key] ?? []).map((point) => ({
    metricId: key,
    value: point.value,
    date: point.date,
    sortKey: `${point.date}|${point.recordedAt}|${point.id}`,
    source: point.source,
    note: point.note,
    sourceRecordId: point.id,
  }));
}

/** What a metric pane renders: its metrics, and its measurement log's rows. */
export type MetricPaneData = {
  /** One summary per metric of the pane, whatever has loaded. */
  metrics: MetricSummary[];
  logRows: LogRow[];
  isLoading: boolean;
  isError: boolean;
};

/** A metric's summary off its points — the figures its hero, chart and log read. */
function summariseMetric(
  def: MetricDefinition,
  points: MetricPoint[],
  hero: ReturnType<typeof deriveHeroStats>,
  today: string,
  viewer: UnitSystem,
  goal: Pick<MetricSummary, "goal" | "goalToGo"> = { goal: null, goalToGo: null }
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
    totalChange: hero?.totalChange ?? null,
    startsOn: hero?.startsOn ?? null,
    avgRate: hero?.avgRate ?? null,
    change30d: deriveWindowChange(points, downIsGood),
    week: deriveWeekComparison(points, today),
    ...goal,
    best: deriveBest(points, downIsGood),
  };
}

/** The Physique pane: the measurement series and the goal, nothing else. */
export const usePhysiqueMetrics = (client: Client): MetricPaneData => {
  const { series, isLoading, isError } = useMeasurementSeries(client.id);
  const { goal: currentGoals } = useClientGoals(client.id);
  const { preference } = useUnits();

  const { metrics, logRows } = useMemo(() => {
    const today = getTodayDateString();
    // The route's start date is the same column the client record carries;
    // the record covers the first render, before the series lands.
    const startDate = series?.startDate ?? client.startDate ?? null;
    const pointsByMetric = new Map(
      BODY_METRIC_DEFINITIONS.map((def) => [
        def.id,
        seriesPoints(series, def.id).map((p) => ({
          ...p,
          value: convertPoint(p.value, def.convert, preference),
        })),
      ])
    );

    // One composer, shared with the three server callers, rather than a private
    // literal. The private one hardcoded `deadline: null` AFTER fetching the
    // full goal — two surfaces rendering "the same" goal from two shapes, one
    // of them deliberately blind. Nothing here reads the deadline (see the goal
    // block below), so that blindness was inert rather than a live bug — but it
    // was one edit away from mattering, which is the whole reason the shape is
    // shared now.
    const effectiveGoal = resolveEffectiveGoal({
      clientGoal: toClientGoalInput(currentGoals, client),
    });

    const summaries = BODY_METRIC_DEFINITIONS.map((def) => {
      const allPoints = pointsByMetric.get(def.id) ?? [];
      // The journey: a physique reading dated before the start is not a point.
      const points = startDate ? allPoints.filter((p) => p.date >= startDate) : allPoints;
      const raw = series?.baseline?.[def.id] ?? null;
      const baseline: HeroBaseline | null = raw
        ? { value: convertPoint(raw.value, def.convert, preference), date: raw.date, source: raw.source }
        : null;
      const hero = deriveHeroStats(points, "body", today, {
        current: allPoints[allPoints.length - 1] ?? null,
        baseline,
        startDate,
      });

      // Goal resolution (weight/bodyFat only).
      let goal: number | null = null;
      let goalToGo: string | null = null;
      if (def.id === "weight" && effectiveGoal.goalWeightKg != null) {
        // The goal is canonical kilograms; convert it the same way the series
        // was, so the difference below is taken between two like numbers.
        const goalDisplay = round1(formatWeight(effectiveGoal.goalWeightKg, preference).value);
        goal = Number(goalDisplay.toFixed(1));
        if (hero) {
          goalToGo = Math.abs(hero.current.value - goalDisplay).toFixed(1);
        }
      } else if (def.id === "bodyFat" && effectiveGoal.goalBodyFatPercentage != null) {
        goal = effectiveGoal.goalBodyFatPercentage;
        if (hero) {
          goalToGo = Math.abs(hero.current.value - goal).toFixed(1);
        }
      }

      return summariseMetric(def, points, hero, today, preference, { goal, goalToGo });
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
      const id = series?.baseline?.[def.id]?.id;
      if (id) baselineIds[def.id] = id;
    }
    const rows: LogRow[] = buildMeasurementLogRows(
      (series?.readings ?? []).map((reading) => ({
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
  }, [series, currentGoals, client, preference]);

  return { metrics, logRows, isLoading, isError };
};

/** The Wellness pane: the check-ins' weekly averages and the coach's entries, nothing else. */
export const useWellnessMetrics = (clientId: string): MetricPaneData => {
  const {
    checkIns,
    isLoading: checkInsLoading,
    isError: checkInsError,
  } = useAllClientCheckIns(clientId);
  const {
    entries,
    isLoading: entriesLoading,
    isError: entriesError,
  } = useMetricEntries(clientId);
  const { preference } = useUnits();

  const { metrics, logRows } = useMemo(() => {
    const today = getTodayDateString();
    // A score is unitless: its points are its values as logged
    const pointsByMetric = buildMetricPoints(checkIns, entries, WELLNESS_METRIC_DEFINITIONS);

    const summaries = WELLNESS_METRIC_DEFINITIONS.map((def) => {
      const points = pointsByMetric.get(def.id) ?? [];
      return summariseMetric(def, points, deriveHeroStats(points, "wellness", today), today, preference);
    });

    // One row per point, no row action (D2).
    const nameById = new Map(WELLNESS_METRIC_DEFINITIONS.map((d) => [d.id, d.name]));
    const unitById = new Map(WELLNESS_METRIC_DEFINITIONS.map((d) => [d.id, d.getUnit(preference)]));
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
      sourceId: null,
      isMeasurement: false,
      voided: null,
      isCurrent: false,
      isBaseline: false,
      beforeStart: false,
    }));

    return { metrics: summaries, logRows: rows };
  }, [checkIns, entries, preference]);

  return {
    metrics,
    logRows,
    isLoading: checkInsLoading || entriesLoading,
    isError: Boolean(checkInsError || entriesError),
  };
};
