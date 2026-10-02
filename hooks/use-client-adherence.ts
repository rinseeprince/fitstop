"use client";

import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { AdherenceSummary } from "@/types/coach-overview";

type AdherenceResponse = { success: boolean; data: AdherenceSummary };

/** The Overview's three-rail window. The route clamps `days` to [7, 60]. */
export const ADHERENCE_WINDOW_DAYS = 14;

/** The area every adherence read of a client lives under. */
function clientAdherenceAreaPrefix(clientId: string): string {
  return `/api/clients/${clientId}/adherence`;
}

/** The key builder. Never construct this URL at a call site. */
export function clientAdherenceKey(clientId: string, days: number): string {
  return `${clientAdherenceAreaPrefix(clientId)}?days=${days}`;
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

/**
 * Drop every cached adherence read of a client, then let them refetch.
 *
 * CLEARED, not merely revalidated (CONVENTIONS §7): the rails render definite
 * answers — a day's dot, "3 days below 50%" — and SWR would serve the stale
 * ones for the whole refetch. Called by every coach habit write that changed
 * something (`useHabitWrites`, as its answer arrives): a habit added,
 * changed, stopped or deleted changes the days the habits rail judges.
 */
export function useClearClientAdherence() {
  const { mutate } = useSWRConfig();
  return useCallback(
    (clientId: string) =>
      mutate(
        (key) => typeof key === "string" && key.startsWith(clientAdherenceAreaPrefix(clientId)),
        undefined,
        { revalidate: true }
      ),
    [mutate]
  );
}
