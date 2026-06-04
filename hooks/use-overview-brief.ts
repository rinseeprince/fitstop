"use client";

import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { OverviewBrief } from "@/types/coach-brief";

type BriefResponse = { success: boolean; data: OverviewBrief };

/**
 * Fetches the coach pre-session brief for a client (Session 7.6). The GET also
 * upserts last_viewed_at server-side, so this intentionally does NOT revalidate
 * on focus — re-fetching on every tab focus would keep resetting "since last
 * visit" to empty.
 */
export function useOverviewBrief(clientId: string) {
  const { data, error, isLoading } = useSWR<BriefResponse>(
    clientId ? `/api/clients/${clientId}/overview-brief` : null,
    swrFetcher,
    { revalidateOnFocus: false, errorRetryCount: 3, errorRetryInterval: 1000 }
  );

  return { brief: data?.data ?? null, isLoading, isError: !!error };
}
