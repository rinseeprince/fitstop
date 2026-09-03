"use client";

import { useCallback, useMemo } from "react";
import { useInvalidateMeasurementSeries } from "@/hooks/use-measurement-series";
import { useInvalidateCheckInDetail } from "@/hooks/use-check-in-detail-data";
import type { LogRow } from "../metrics-view-types";

type ReadingAction = "correct" | "void" | "restore";

/**
 * The three row actions of the measurement log, each a POST to its route and
 * then the three invalidations a changed reading owes (CONVENTIONS §7):
 *
 *  - the series area — the Journey's pane and log, the Overview's chart and
 *    status band, all readers of one key;
 *  - the client record, through `onClientUpdated`, for a weight or body fat:
 *    its "now" readings and the energy pair live there (the record carries no
 *    girth, so a girth leaves it alone);
 *  - the check-in the reading reports on, when it carries a stamp: its report,
 *    band and comparison read the stamped rows.
 */
export function useReadingActions(clientId: string, onClientUpdated?: () => void) {
  const invalidateSeries = useInvalidateMeasurementSeries();
  const invalidateCheckInDetail = useInvalidateCheckInDetail();

  const settle = useCallback(
    async (row: LogRow) => {
      await invalidateSeries(clientId);
      if (row.metricId === "weight" || row.metricId === "bodyFat") onClientUpdated?.();
      if (row.sourceId) await invalidateCheckInDetail(row.sourceId);
    },
    [clientId, invalidateSeries, onClientUpdated, invalidateCheckInDetail]
  );

  const post = useCallback(
    async (row: LogRow, action: ReadingAction, body?: Record<string, unknown>) => {
      const res = await fetch(`/api/clients/${clientId}/measurements/${row.id}/${action}`, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to update the reading");
      }
      await settle(row);
    },
    [clientId, settle]
  );

  return useMemo(
    () => ({
      correct: (row: LogRow, valueCanonical: number) =>
        post(row, "correct", { value: valueCanonical }),
      remove: (row: LogRow) => post(row, "void"),
      restore: (row: LogRow) => post(row, "restore"),
    }),
    [post]
  );
}
