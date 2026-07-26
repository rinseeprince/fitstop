"use client";

import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { AdherenceSummary } from "@/types/coach-overview";

type AdherenceResponse = { success: boolean; data: AdherenceSummary };

/** The Overview's three-rail window. The route clamps `days` to [7, 28]. */
export const ADHERENCE_WINDOW_DAYS = 14;

/**
 * Training / nutrition / habit adherence over a shared date window, one dot per
 * date per rail (all three rails are index-aligned with `dates`).
 */
export function useClientAdherence(clientId: string, days: number = ADHERENCE_WINDOW_DAYS) {
  const { data, error, isLoading } = useSWR<AdherenceResponse>(
    clientId ? `/api/clients/${clientId}/adherence?days=${days}` : null,
    swrFetcher,
    { revalidateOnFocus: false, errorRetryCount: 3, errorRetryInterval: 1000 }
  );

  return { adherence: data?.data ?? null, isLoading, isError: !!error };
}
