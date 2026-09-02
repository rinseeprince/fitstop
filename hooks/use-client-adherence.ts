"use client";

import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { AdherenceSummary } from "@/types/coach-overview";

type AdherenceResponse = { success: boolean; data: AdherenceSummary };

/** The Overview's three-rail window. The route clamps `days` to [7, 60]. */
export const ADHERENCE_WINDOW_DAYS = 14;

/** The key builder. Never construct this URL at a call site. */
function clientAdherenceKey(clientId: string, days: number): string {
  return `/api/clients/${clientId}/adherence?days=${days}`;
}

/**
 * Training / nutrition / habit adherence over a shared date window, one dot per
 * date per rail (all three rails are index-aligned with `dates`).
 *
 * `days` stays REQUIRED even though there is one caller passing one constant:
 * a default here would be a second, silent spelling of a number the route
 * already owns (`DEFAULT_DAYS`), and those two drifting is how a rail comes to
 * say "Last 14 days" over 28 days of dots.
 */
export function useClientAdherence(clientId: string, days: number) {
  const { data, error, isLoading } = useSWR<AdherenceResponse>(
    clientId ? clientAdherenceKey(clientId, days) : null,
    swrFetcher,
    { revalidateOnFocus: false, errorRetryCount: 3, errorRetryInterval: 1000 }
  );

  return { adherence: data?.data ?? null, isLoading, isError: !!error };
}
