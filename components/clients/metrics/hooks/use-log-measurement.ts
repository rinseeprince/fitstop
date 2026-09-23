"use client";

import { useCallback } from "react";
import {
  useClearMeasurementSeries,
  useInvalidateMeasurementSeries,
} from "@/hooks/use-measurement-series";
import { useClearClientGoals, useInvalidateClientGoals } from "@/hooks/use-client-goals";
import { useClearNutritionGoal } from "@/hooks/use-nutrition-goal";
import type { CreateMetricEntryRequest } from "@/types/metric-entries";
import type { JourneySubtab } from "../metrics-view-types";

/**
 * The Journey's Log measurement, the same from every pane that offers it: one
 * POST, then the refresh the reading owes (CONVENTIONS §7).
 *
 * A body measurement lands in the measurement log, which the Physique and Goals
 * panes and the Overview read — and a weight or body fat may be the reading a
 * goal's progress runs from, which the goals read carries. The pane on screen
 * (`onScreen`, from the address) is refreshed IN PLACE: its reader refetches
 * and keeps what it shows until the new reading lands, and the dialog stays
 * open on its spinner until then, so no frame after the save shows the old
 * reading, and none shows a loading state. A store no pane on screen reads is
 * CLEARED: nothing is mounted to refetch it, so a revalidation would fetch
 * nothing and the next view to open it — Physique, Goals or the Overview —
 * would serve the old reading first. Cleared, that view starts from its
 * loading state.
 */
export function useLogMeasurement(
  clientId: string,
  onScreen: JourneySubtab | null,
  onClientUpdated?: () => void
) {
  const refreshSeries = useInvalidateMeasurementSeries();
  const clearSeries = useClearMeasurementSeries();
  const refreshGoals = useInvalidateClientGoals();
  const clearGoals = useClearClientGoals();
  const clearNutritionGoal = useClearNutritionGoal();

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
      // Physique and Goals both read the series and the goals.
      const readsMeasurements = onScreen === "body" || onScreen === "goals";
      await (readsMeasurements ? refreshSeries : clearSeries)(clientId);
      // A weight or body fat may be the client's newest reading — refresh the
      // client record so "now", the goal "to go" stat and the pair go live —
      // and may be the reading on a goal's start day, which the goal chips
      // measure from. The nutrition drawer prices from the same newest weight
      // and energy pair, on no screen shown here, so its read is cleared.
      if (input.metricKey === "weight" || input.metricKey === "bodyFat") {
        await (readsMeasurements ? refreshGoals : clearGoals)(clientId);
        void clearNutritionGoal(clientId);
        onClientUpdated?.();
      }
    },
    [
      clientId,
      onScreen,
      onClientUpdated,
      refreshSeries,
      clearSeries,
      refreshGoals,
      clearGoals,
      clearNutritionGoal,
    ]
  );
}
