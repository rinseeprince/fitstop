"use client";

import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { OverviewWindow } from "@/lib/overview/window";
import type { MeasurementSeries } from "@/types/coach-overview";

type MeasurementSeriesResponse = { success: boolean; data: MeasurementSeries };

/** The key builder. Never construct this URL at a call site. */
export function measurementSeriesKey(clientId: string, days: OverviewWindow): string {
  return `/api/clients/${clientId}/measurement-series?days=${days}`;
}

/**
 * The Overview progression chart's series, bounded to the selected window.
 *
 * Keyed on the window, so switching 30 ⇄ 60 fetches once per window and then
 * serves from cache — SWR keeps the previous series on screen while the next
 * one loads rather than blanking the chart.
 */
export function useMeasurementSeries(clientId: string, days: OverviewWindow) {
  const { data, error, isLoading } = useSWR<MeasurementSeriesResponse>(
    clientId ? measurementSeriesKey(clientId, days) : null,
    swrFetcher,
    { revalidateOnFocus: false, errorRetryCount: 3, errorRetryInterval: 1000 }
  );

  return { series: data?.data ?? null, isLoading, isError: !!error };
}

/**
 * Invalidates every window of a client's series.
 *
 * Matches the API AREA, not one key: the series is keyed per window, so a
 * logged measurement has to clear both 30 and 60 or the coach switches windows
 * and reads a chart that predates their own entry.
 */
export function useInvalidateMeasurementSeries() {
  const { mutate } = useSWRConfig();

  return useCallback(
    (clientId: string) =>
      mutate(
        (key) =>
          typeof key === "string" &&
          key.startsWith(`/api/clients/${clientId}/measurement-series`)
      ),
    [mutate]
  );
}
