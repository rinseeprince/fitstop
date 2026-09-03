"use client";

import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { WellnessSeries } from "@/types/coach-overview";

type WellnessSeriesResponse = { success: boolean; data: WellnessSeries };

/** The key builder. Never construct this URL at a call site. */
function wellnessSeriesKey(clientId: string): string {
  return `/api/clients/${clientId}/wellness-series`;
}

/**
 * The client's whole wellness journey — the five wellness metrics as
 * day-values from their own daily log. Its own key beside the measurement
 * series (owner decision D19): the Overview chart shares that one and draws
 * no wellness point. Read by the Journey's Wellness pane.
 */
export function useWellnessSeries(clientId: string) {
  const { data, error, isLoading } = useSWR<WellnessSeriesResponse>(
    clientId ? wellnessSeriesKey(clientId) : null,
    swrFetcher,
    { revalidateOnFocus: false, errorRetryCount: 3, errorRetryInterval: 1000 }
  );

  return { series: data?.data ?? null, isLoading, isError: !!error };
}

/**
 * Invalidates a client's wellness series from outside the hook that read it —
 * the one sanctioned way (CONVENTIONS §7). Matches the API AREA, not one key.
 */
export function useInvalidateWellnessSeries() {
  const { mutate } = useSWRConfig();

  return useCallback(
    (clientId: string) =>
      mutate(
        (key) =>
          typeof key === "string" &&
          key.startsWith(`/api/clients/${clientId}/wellness-series`)
      ),
    [mutate]
  );
}
