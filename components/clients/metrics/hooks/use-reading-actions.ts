"use client";

import { useCallback, useMemo } from "react";
import { useInvalidateMeasurementSeries } from "@/hooks/use-measurement-series";
import { useInvalidateClientGoals } from "@/hooks/use-client-goals";
import { useClearNutritionGoal } from "@/hooks/use-nutrition-goal";
import { useClearClientOverview } from "@/hooks/use-client-overview";
import type { LogRow } from "../metrics-view-types";

/**
 * The three row actions of the measurement log — an edit is a PATCH of the
 * reading, a removal and a restore are POSTs to its two state routes — each
 * followed by the invalidations a changed reading owes (CONVENTIONS §7):
 *
 *  - the series area — the Journey's pane and log, the Overview's chart and
 *    status band, all readers of one key;
 *  - the Overview's own reads, CLEARED: its "Since your last visit" lists the
 *    coach's readings — a removed one leaves it, an edited one changes, a
 *    restored one returns — and no Journey pane shows it;
 *  - the client record, through `onClientUpdated`, for a weight or body fat:
 *    its "now" readings and the energy pair live there (the record carries no
 *    girth, so a girth leaves it alone) — and the goals area, since a weight or
 *    body fat may be the reading on a goal's start day, which its chips
 *    measure from — and how nutrition follows the goal, whose day read prices
 *    from the newest weight and the energy pair.
 *
 * A reading a check-in reported is corrected in the client's log only: the
 * check-in keeps what it reported (its saved copy, lib/check-in/sent-snapshot.ts;
 * owner ruling 2026-09-22), so no check-in read is refreshed.
 */
export function useReadingActions(clientId: string, onClientUpdated?: () => void) {
  const invalidateSeries = useInvalidateMeasurementSeries();
  const invalidateGoals = useInvalidateClientGoals();
  const clearNutritionGoal = useClearNutritionGoal();
  const clearOverview = useClearClientOverview();

  const settle = useCallback(
    async (row: LogRow) => {
      void clearOverview(clientId);
      await invalidateSeries(clientId);
      if (row.metricId === "weight" || row.metricId === "bodyFat") {
        await invalidateGoals(clientId);
        void clearNutritionGoal(clientId);
        onClientUpdated?.();
      }
    },
    [clientId, invalidateSeries, onClientUpdated, invalidateGoals, clearNutritionGoal, clearOverview]
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
