"use client";

import { useCallback, useMemo } from "react";
import useSWR from "swr";
import { useAllClientCheckIns } from "@/hooks/use-check-in-data";
import { useMetricEntries } from "@/hooks/use-metric-entries";
import { swrFetcher } from "@/lib/swr-fetcher";
import { getTodayDateString } from "@/lib/date-helpers";
import { DOWN_IS_GOOD } from "@/lib/metrics/metric-entry-definitions";
import { resolveEffectiveGoal } from "@/lib/goals/resolve-effective-goal";
import { buildMetricPoints } from "@/utils/metric-points";
import {
  buildLogRows,
  deriveBest,
  deriveFrequencyLabel,
  deriveHeroStats,
  deriveWeekComparison,
  deriveWindowChange,
} from "@/utils/metric-derived-stats";
import { METRIC_DEFINITIONS } from "./use-metrics-data";
import type { LogRow, MetricSummary, MetricTab } from "../metrics-view-types";
import type { Client } from "@/types/check-in";
import type { CreateMetricEntryRequest } from "@/types/metric-entries";

// Coach-side measurement unit is fixed to inches on this page (pre-existing
// behavior — client.unitPreference is deliberately not consulted here).
const MEASUREMENT_UNIT = "in";

// Method bivariance makes the narrow ReadonlySet<MetricEntryKey> usable where
// plain string ids are looked up.
const DOWN_SET: ReadonlySet<string> = DOWN_IS_GOOD;

type GoalsResponse = {
  success: boolean;
  data: { goalWeight?: number; goalBodyFatPercentage?: number | null } | null;
};

export type UseMergedMetricsResult = {
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
  const { data: goalsData } = useSWR<GoalsResponse>(
    `/api/clients/${client.id}/goals`,
    swrFetcher,
    { revalidateOnFocus: false, errorRetryCount: 1 }
  );

  const { metricsByTab, logRowsByTab } = useMemo(() => {
    const today = getTodayDateString();
    const pointsByMetric = buildMetricPoints(checkIns, entries, METRIC_DEFINITIONS);

    const currentGoals = goalsData?.data ?? null;
    const effectiveGoal = resolveEffectiveGoal({
      // Legacy fallback to the denormalized client fields mirrors
      // services/comparison-service's read switch.
      clientGoal: {
        goalWeight: currentGoals?.goalWeight ?? client.goalWeight ?? null,
        goalBodyFatPercentage:
          currentGoals?.goalBodyFatPercentage ??
          client.goalBodyFatPercentage ??
          null,
        deadline: null,
        startDate: null,
      },
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
        goal = Number(effectiveGoal.goalWeightKg.toFixed(1));
        if (hero) {
          goalToGo = Math.abs(
            hero.current.value - effectiveGoal.goalWeightKg
          ).toFixed(1);
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
        unit: def.getUnit(client.weightUnit, MEASUREMENT_UNIT),
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
        d.getUnit(client.weightUnit, MEASUREMENT_UNIT),
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
  }, [checkIns, entries, goalsData, client]);

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
