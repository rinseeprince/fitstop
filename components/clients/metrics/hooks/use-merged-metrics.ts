"use client";

import { useCallback, useMemo } from "react";
import { useAllClientCheckIns } from "@/hooks/use-check-in-data";
import { useClientGoals } from "@/hooks/use-client-goals";
import { useMetricEntries } from "@/hooks/use-metric-entries";
import { getTodayDateString } from "@/lib/date-helpers";
import { DOWN_IS_GOOD } from "@/lib/metrics/metric-entry-definitions";
import {
  resolveEffectiveGoal,
  toClientGoalInput,
} from "@/lib/goals/resolve-effective-goal";
import { buildMetricPoints } from "@/utils/metric-points";
import {
  buildLogRows,
  deriveBest,
  deriveFrequencyLabel,
  deriveHeroStats,
  deriveWeekComparison,
  deriveWindowChange,
} from "@/utils/metric-derived-stats";
import { METRIC_DEFINITIONS, type MetricDefinition } from "./use-metrics-data";
import { useUnits } from "@/contexts/units-context";
import { formatLength, formatWeight, type UnitSystem } from "@/utils/unit-conversions";
import type { LogRow, MetricSummary, MetricTab } from "../metrics-view-types";
import type { Client } from "@/types/check-in";
import type { CreateMetricEntryRequest } from "@/types/metric-entries";

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
  const { goal: currentGoals } = useClientGoals(client.id);

  const { preference } = useUnits();

  const { metricsByTab, logRowsByTab } = useMemo(() => {
    const today = getTodayDateString();
    const rawPointsByMetric = buildMetricPoints(checkIns, entries, METRIC_DEFINITIONS);
    const convertBy = new Map(METRIC_DEFINITIONS.map((d) => [d.id, d.convert]));
    const pointsByMetric = new Map(
      [...rawPointsByMetric].map(([id, pts]) => [
        id,
        pts.map((p) => ({ ...p, value: convertPoint(p.value, convertBy.get(id), preference) })),
      ]),
    );

    // One composer, shared with the three server callers, rather than a private
    // literal. The private one hardcoded `deadline: null, startDate: null` AFTER
    // fetching the full goal — two surfaces rendering "the same" goal from two
    // shapes, one of them deliberately blind. Nothing here reads either field
    // (see the goal block below), so that blindness was inert rather than a live
    // bug — but it was one edit away from mattering, which is the whole reason
    // the shape is shared now.
    //
    // `today` stays the device day: it also anchors deriveHeroStats and
    // deriveWeekComparison below, so moving it to the client's zone is a
    // different change with a different blast radius, not part of this one.
    const effectiveGoal = resolveEffectiveGoal({
      clientGoal: toClientGoalInput(currentGoals, client),
      today,
    });

    const byTab: Record<MetricTab, MetricSummary[]> = { body: [], wellness: [] };
    for (const def of METRIC_DEFINITIONS) {
      const points = pointsByMetric.get(def.id) ?? [];
      const downIsGood = DOWN_SET.has(def.id);
      const hero = deriveHeroStats(points, def.category, today);

      // Goal resolution (weight/bodyFat only).
      let goal: number | null = null;
      let goalToGo: string | null = null;
      if (def.id === "weight" && effectiveGoal.goalWeightKg != null) {
        // Goal, hero value and difference are all kilograms (migration 141), so
        // the round-trip through display units is gone. Phase 3 converts these
        // at the render boundary.
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
        frequencyLabel: deriveFrequencyLabel(points),
        totalChange: hero?.totalChange ?? null,
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
    const decorate = (category: MetricTab): LogRow[] =>
      buildLogRows(pointsByMetric, METRIC_DEFINITIONS, category, DOWN_SET).map(
        (row) => ({
          ...row,
          metricName: nameById.get(row.metricId) ?? row.metricId,
          unit: unitById.get(row.metricId) ?? "",
        })
      );

    return {
      metricsByTab: byTab,
      logRowsByTab: { body: decorate("body"), wellness: decorate("wellness") },
    };
    // `preference` is a real dependency: it changes every value in the series,
    // not just the label.
  }, [checkIns, entries, currentGoals, client, preference]);

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
      await mutateEntries();
      // Weight/bodyFat entries may have moved the denormalized client cache —
      // refresh the client record so the goal "to go" stat goes live.
      if (input.metricKey === "weight" || input.metricKey === "bodyFat") {
        onClientUpdated?.();
      }
    },
    [client.id, mutateEntries, onClientUpdated]
  );

  return {
    metricsByTab,
    logRowsByTab,
    isLoading: checkInsLoading || entriesLoading,
    isError: Boolean(checkInsError || entriesError),
    logMeasurement,
  };
};
