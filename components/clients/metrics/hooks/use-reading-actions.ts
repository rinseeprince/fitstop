"use client";

import { useCallback, useMemo } from "react";
import { useInvalidateMeasurementSeries } from "@/hooks/use-measurement-series";
import { useInvalidateCheckInDetail } from "@/hooks/use-check-in-detail-data";
import type { LogRow } from "../metrics-view-types";

/**
 * The three row actions of the measurement log — an edit is a PATCH of the
 * reading, a removal and a restore are POSTs to its two state routes — each
 * followed by the three invalidations a changed reading owes (CONVENTIONS §7):
 *
 *  - the series area — the Journey's pane and log, the Overview's chart and
 *    status band, all readers of one key;
 *  - the client record, through `onClientUpdated`, for a weight or body fat:
 *    its "now" readings and the energy pair live there (the record carries no
 *    girth, so a girth leaves it alone);
 *  - the check-in the reading reports on, when it carries a stamp: its report,
 *    band and comparison read the stamped row.
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

  const send = useCallback(
    async (
      row: LogRow,
      method: "PATCH" | "POST",
      path: string,
      body?: Record<string, unknown>
    ) => {
      const res = await fetch(path, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to update the reading");
      }
      await settle(row);
    },
    [settle]
  );

  return useMemo(() => {
    const reading = (row: LogRow) => `/api/clients/${clientId}/measurements/${row.id}`;
    return {
      update: (row: LogRow, valueCanonical: number) =>
        send(row, "PATCH", reading(row), { value: valueCanonical }),
      remove: (row: LogRow) => send(row, "POST", `${reading(row)}/void`),
      restore: (row: LogRow) => send(row, "POST", `${reading(row)}/restore`),
    };
  }, [clientId, send]);
}
