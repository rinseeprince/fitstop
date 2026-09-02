"use client";

import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { MeasurementSeries } from "@/types/coach-overview";

type MeasurementSeriesResponse = { success: boolean; data: MeasurementSeries };

/** The key builder. Never construct this URL at a call site. */
function measurementSeriesKey(clientId: string, from?: string | null): string {
  const base = `/api/clients/${clientId}/measurement-series`;
  return from ? `${base}?from=${from}` : base;
}

/**
 * The client's whole measurement journey, for the Overview progression chart.
 *
 * `from` is the client's own start date — the browser already holds it, so
 * passing it saves the route a round trip for a fact its caller has. It is part
 * of the key because a corrected start date genuinely changes which readings
 * belong to the journey.
 */
export function useMeasurementSeries(clientId: string, from?: string | null) {
  const { data, error, isLoading } = useSWR<MeasurementSeriesResponse>(
    clientId ? measurementSeriesKey(clientId, from) : null,
    swrFetcher,
    { revalidateOnFocus: false, errorRetryCount: 3, errorRetryInterval: 1000 }
  );

  return { series: data?.data ?? null, isLoading, isError: !!error };
}

/**
 * Invalidates a client's series, whatever `from` it was read with.
 *
 * Matches the API AREA, not one key. A save that corrects the start date
 * changes the key AND the data behind the old one, so clearing only the key in
 * hand would leave a stale series cached under the previous start date.
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
