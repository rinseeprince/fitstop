"use client";

import { useCallback } from "react";
import {
  useClearMeasurementSeries,
  useInvalidateMeasurementSeries,
} from "@/hooks/use-measurement-series";
import {
  useClearMetricEntries,
  useInvalidateMetricEntries,
} from "@/hooks/use-metric-entries";
import { useClearClientGoals, useInvalidateClientGoals } from "@/hooks/use-client-goals";
import { isMeasurementKey } from "@/lib/measurements/keys";
import type { CreateMetricEntryRequest } from "@/types/metric-entries";
import type { MetricTab } from "../metrics-view-types";

/**
 * The Journey's Log measurement, the same from every pane: one POST, then the
 * refresh the reading owes (CONVENTIONS §7).
 *
 * A body measurement lands in the measurement log, which the Physique pane and
 * the Overview read — and a weight or body fat may be the reading a goal's
 * progress runs from, which the goals read carries; a wellness score lands in
 * the coach's entries, which the Wellness pane reads. The pane on screen (`onScreen`, from the address) is
 * refreshed IN PLACE: its reader refetches and keeps what it shows until the
 * new reading lands, and the dialog stays open on its spinner until then, so no
 * frame after the save shows the old reading, and none shows a loading state.
 * A store no pane on screen reads is CLEARED: nothing is mounted to refetch it,
 * so a revalidation would fetch nothing and the next view to open it —
 * Physique, Wellness or the Overview — would serve the old reading first.
 * Cleared, that view starts from its loading state.
 */
export function useLogMeasurement(
  clientId: string,
  onScreen: MetricTab | null,
  onClientUpdated?: () => void
) {
  const refreshSeries = useInvalidateMeasurementSeries();
  const clearSeries = useClearMeasurementSeries();
  const refreshEntries = useInvalidateMetricEntries();
  const clearEntries = useClearMetricEntries();
  const refreshGoals = useInvalidateClientGoals();
  const clearGoals = useClearClientGoals();

  return useCallback(
    async (input: CreateMetricEntryRequest) => {
      const res = await fetch(`/api/clients/${clientId}/metric-entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to log measurement");
      }
      if (isMeasurementKey(input.metricKey)) {
        await (onScreen === "body" ? refreshSeries : clearSeries)(clientId);
        // A weight or body fat may be the client's newest reading — refresh
        // the client record so "now", the goal "to go" stat and the pair go live
        // — and may be the reading on a goal's start day, which the goal chips
        // measure from.
        if (input.metricKey === "weight" || input.metricKey === "bodyFat") {
          await (onScreen === "body" ? refreshGoals : clearGoals)(clientId);
          onClientUpdated?.();
        }
      } else {
        await (onScreen === "wellness" ? refreshEntries : clearEntries)(clientId);
      }
    },
    [
      clientId,
      onScreen,
      onClientUpdated,
      refreshSeries,
      clearSeries,
      refreshEntries,
      clearEntries,
      refreshGoals,
      clearGoals,
    ]
  );
}
