"use client";

import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { MeasurementSeries } from "@/types/coach-overview";

type MeasurementSeriesResponse = { success: boolean; data: MeasurementSeries };

/** The key builder. Never construct this URL at a call site. */
function measurementSeriesKey(clientId: string): string {
  return `/api/clients/${clientId}/measurement-series`;
}

/**
 * The client's whole measurement journey — every metric's day-values from the
 * measurement log, the derived baseline and the start date. One key for the
 * Overview chart and the Journey's Physique pane, so a reading logged on one
 * reaches the other through the same cache.
 */
export function useMeasurementSeries(clientId: string) {
  const { data, error, isLoading } = useSWR<MeasurementSeriesResponse>(
    clientId ? measurementSeriesKey(clientId) : null,
    swrFetcher,
    { revalidateOnFocus: false, errorRetryCount: 3, errorRetryInterval: 1000 }
  );

  return { series: data?.data ?? null, isLoading, isError: !!error };
}

/**
 * Invalidates a client's series from outside the hook that read it — the one
 * sanctioned way (CONVENTIONS §7). Matches the API AREA, not one key.
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
