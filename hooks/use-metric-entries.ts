"use client";

import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { GetMetricEntriesResponse } from "@/types/metric-entries";

/** The key builder. Never construct this URL at a call site (CONVENTIONS §7). */
function metricEntriesKey(clientId: string): string {
  return `/api/clients/${clientId}/metric-entries`;
}

// Coach-logged WELLNESS entries for a client (client_metric_entries). The
// Journey's Wellness pane merges these with the check-ins' weekly averages
// client-side; a physique reading is a row in the measurement log instead.
export const useMetricEntries = (clientId: string) => {
  const { data, error, isLoading } = useSWR<GetMetricEntriesResponse>(
    clientId ? metricEntriesKey(clientId) : null,
    swrFetcher,
    {
      revalidateOnFocus: false,
    }
  );

  return {
    entries: data?.data ?? [],
    isLoading,
    isError: error,
  };
};

/** Every read of a client's entries matches the area, so a reader added later is covered. */
const inEntriesArea = (clientId: string) => (key: unknown) =>
  typeof key === "string" && key.startsWith(metricEntriesKey(clientId));

/**
 * Refreshes a client's entries in place — for a write made while the Wellness
 * pane shows them: its reader refetches and keeps showing what it has until the
 * new entries land.
 */
export function useInvalidateMetricEntries() {
  const { mutate } = useSWRConfig();
  return useCallback((clientId: string) => mutate(inEntriesArea(clientId)), [mutate]);
}

/**
 * Drops a client's cached entries, then lets them refetch — for a write made
 * while no pane shows them. CLEARED, not merely revalidated (CONVENTIONS §7):
 * with no reader mounted a revalidation fetches nothing, and the next Wellness
 * view would serve the stale entries — its hero and log claiming the old
 * values — for the whole refetch. Cleared, it opens in the pending state it
 * already has.
 */
export function useClearMetricEntries() {
  const { mutate } = useSWRConfig();
  return useCallback(
    (clientId: string) => mutate(inEntriesArea(clientId), undefined, { revalidate: true }),
    [mutate]
  );
}
