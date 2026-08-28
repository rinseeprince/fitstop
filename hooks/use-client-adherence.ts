"use client";

import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { AdherenceSummary } from "@/types/coach-overview";

type AdherenceResponse = { success: boolean; data: AdherenceSummary };

/** The key builder. Never construct this URL at a call site. */
export function clientAdherenceKey(clientId: string, days: number): string {
  return `/api/clients/${clientId}/adherence?days=${days}`;
}

/**
 * Training / nutrition / habit adherence over a shared date window, one dot per
 * date per rail (all three rails are index-aligned with `dates`), plus the
 * per-habit breakdown behind the Signals card's habits panel.
 *
 * `days` is REQUIRED. It used to default to a local `ADHERENCE_WINDOW_DAYS`
 * constant, which stopped being reachable the moment the Overview started
 * passing its own window — leaving a second, silent spelling of a number the
 * route already owns (`DEFAULT_DAYS`). The route still clamps to [7, 60].
 */
export function useClientAdherence(clientId: string, days: number) {
  const { data, error, isLoading } = useSWR<AdherenceResponse>(
    clientId ? clientAdherenceKey(clientId, days) : null,
    swrFetcher,
    { revalidateOnFocus: false, errorRetryCount: 3, errorRetryInterval: 1000 }
  );

  return { adherence: data?.data ?? null, isLoading, isError: !!error };
}

/**
 * Invalidates every window of a client's adherence.
 *
 * Matches the API AREA, not one key: the read is keyed per window, so a write
 * that moves adherence has to clear 30 and 60 together or the coach switches
 * windows and reads a figure that predates their own change.
 */
export function useInvalidateClientAdherence() {
  const { mutate } = useSWRConfig();

  return useCallback(
    (clientId: string) =>
      mutate(
        (key) =>
          typeof key === "string" &&
          key.startsWith(`/api/clients/${clientId}/adherence`)
      ),
    [mutate]
  );
}
