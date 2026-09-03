"use client";

import { useCallback, useMemo } from "react";
import { useAllClientCheckIns } from "@/hooks/use-check-in-data";
import { useClientGoals } from "@/hooks/use-client-goals";
import { useMetricEntries } from "@/hooks/use-metric-entries";
import {
  useInvalidateMeasurementSeries,
  useMeasurementSeries,
} from "@/hooks/use-measurement-series";
import { getTodayDateString } from "@/lib/date-helpers";
import { DOWN_IS_GOOD } from "@/lib/metrics/metric-entry-definitions";
import { isMeasurementKey, type MeasurementKey } from "@/lib/measurements/keys";
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
  METRIC_DEFINITIONS,
  WELLNESS_METRIC_DEFINITIONS,
  type MetricDefinition,
} from "./use-metrics-data";
import { useUnits } from "@/contexts/units-context";
import { formatLength, formatWeight, type UnitSystem } from "@/utils/unit-conversions";
import type { LogRow, MetricSummary, MetricTab } from "../metrics-view-types";
import type { Client } from "@/types/check-in";
import type { CreateMetricEntryRequest } from "@/types/metric-entries";
import type { MeasurementSeries } from "@/types/coach-overview";

/**
 * The Journey's two panes read two stores, deliberately (owner decision D2):
 *
 *  - PHYSIQUE (the seven body measurements) reads the measurement log's
 *    day-values through the series route — one value per day, of any source,
 *    with the baseline (the reading as of the start date) beside it. Readings
 *    dated before the start date are listed under "Before start" and kept out
 *    of the chart and every derived figure.
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

type UseMergedMetricsResult = {
  metricsByTab: Record<MetricTab, MetricSummary[]>;
  logRowsByTab: Record<MetricTab, LogRow[]>;
  isLoading: boolean;
  isError: boolean;
  logMeasurement: (input: CreateMetricEntryRequest) => Promise<void>;
};

export const useMergedMetrics = (
  client: Client,
  onClientUpdated?: () => void
): UseMergedMetricsResult => {
  const {
    checkIns,
    isLoading: checkInsLoading,
    isError: checkInsError,
  } = useAllClientCheckIns(client.id);
  const {
    entries,
    isLoading: entriesLoading,
    isError: entriesError,
    mutate: mutateEntries,
  } = useMetricEntries(client.id);
  const {
    series,
    isLoading: seriesLoading,
    isError: seriesError,
  } = useMeasurementSeries(client.id);
  const invalidateSeries = useInvalidateMeasurementSeries();
  const { goal: currentGoals } = useClientGoals(client.id);

  const { preference } = useUnits();

  const { metricsByTab, logRowsByTab } = useMemo(() => {
    const today = getTodayDateString();
    // The route's start date is the same column the client record carries;
    // the record covers the first render, before the series lands.
    const startDate = series?.startDate ?? client.startDate ?? null;

    const rawPointsByMetric = buildMetricPoints(checkIns, entries, WELLNESS_METRIC_DEFINITIONS);
    for (const def of BODY_METRIC_DEFINITIONS) {
      rawPointsByMetric.set(def.id, seriesPoints(series, def.id));
    }
    const convertBy = new Map(METRIC_DEFINITIONS.map((d) => [d.id, d.convert]));
    const pointsByMetric = new Map(
      [...rawPointsByMetric].map(([id, pts]) => [
        id,
        pts.map((p) => ({ ...p, value: convertPoint(p.value, convertBy.get(id), preference) })),
      ]),
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

    const byTab: Record<MetricTab, MetricSummary[]> = { body: [], wellness: [] };
    for (const def of METRIC_DEFINITIONS) {
      const allPoints = pointsByMetric.get(def.id) ?? [];
      const isBody = def.category === "body";
      // The journey: a physique reading dated before the start is not a point.
      const points =
        isBody && startDate ? allPoints.filter((p) => p.date >= startDate) : allPoints;
      const downIsGood = DOWN_SET.has(def.id);

      let baseline: HeroBaseline | null = null;
      if (def.category === "body") {
        const raw = series?.baseline?.[def.id] ?? null;
        baseline = raw
          ? {
              value: convertPoint(raw.value, def.convert, preference),
              date: raw.date,
              source: raw.source,
            }
          : null;
      }
      const hero = deriveHeroStats(
        points,
        def.category,
        today,
        isBody
          ? { current: allPoints[allPoints.length - 1] ?? null, baseline, startDate }
          : undefined
      );

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
      } else if (
        def.id === "bodyFat" &&
        effectiveGoal.goalBodyFatPercentage != null
      ) {
        goal = effectiveGoal.goalBodyFatPercentage;
        if (hero) {
          goalToGo = Math.abs(hero.current.value - goal).toFixed(1);
        }
      }

      byTab[def.category].push({
        id: def.id,
        name: def.name,
        tab: def.category,
        unit: def.getUnit(preference),
        points,
        latest: hero?.current ?? null,
        first: points.length
          ? { value: points[0].value, date: points[0].date }
          : null,
        entryCount: points.length,
        totalChange: hero?.totalChange ?? null,
        startsOn: hero?.startsOn ?? null,
        avgRate: hero?.avgRate ?? null,
        change30d: deriveWindowChange(points, downIsGood),
        week: deriveWeekComparison(points, today),
        goal,
        goalToGo,
        best: deriveBest(points, downIsGood),
      });
    }

    const nameById = new Map(METRIC_DEFINITIONS.map((d) => [d.id, d.name]));
    const unitById = new Map(
      METRIC_DEFINITIONS.map((d) => [
        d.id,
        d.getUnit(preference),
      ])
    );

    // PHYSIQUE rows are one per reading — newest day first, within a day the
    // most recently written first, a removed reading with its removal. A
    // row's change is taken against the previous day's standing value, and
    // the chart and the figures above read the day-values (`points`). Values
    // convert here, like the points, so a delta sits between two like
    // numbers; the canonical value rides along for the Edit dialog's seed.
    // Before-start rows are flagged so the section can group them.
    const decorateBody = <T extends { metricId: MeasurementKey; date: string }>(row: T) => ({
      ...row,
      metricName: nameById.get(row.metricId) ?? row.metricId,
      unit: unitById.get(row.metricId) ?? "",
      isMeasurement: true,
      beforeStart: startDate != null && row.date < startDate,
    });
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
    const bodyRows: LogRow[] = buildMeasurementLogRows(
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
    ).map((row) => decorateBody(row));

    // WELLNESS rows keep the merged points (D2): one per point, no row action.
    const wellnessRows: LogRow[] = buildLogRows(
      pointsByMetric,
      METRIC_DEFINITIONS,
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

    return {
      metricsByTab: byTab,
      logRowsByTab: { body: bodyRows, wellness: wellnessRows },
    };
    // `preference` is a real dependency: it changes every value in the series,
    // not just the label.
  }, [checkIns, entries, series, currentGoals, client, preference]);

  const logMeasurement = useCallback(
    async (input: CreateMetricEntryRequest) => {
      const res = await fetch(`/api/clients/${client.id}/metric-entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to log measurement");
      }
      if (isMeasurementKey(input.metricKey)) {
        // The reading landed in the measurement log: the series area serves
        // this pane AND the Overview chart, so both refresh from one call.
        await invalidateSeries(client.id);
        // A weight or body fat may be the client's newest reading — refresh
        // the client record so "now", the goal "to go" stat and the pair go live.
        if (input.metricKey === "weight" || input.metricKey === "bodyFat") {
          onClientUpdated?.();
        }
      } else {
        await mutateEntries();
      }
    },
    [client.id, invalidateSeries, mutateEntries, onClientUpdated]
  );

  return {
    metricsByTab,
    logRowsByTab,
    isLoading: checkInsLoading || entriesLoading || seriesLoading,
    isError: Boolean(checkInsError || entriesError || seriesError),
    logMeasurement,
  };
};
