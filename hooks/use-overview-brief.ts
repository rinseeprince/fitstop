"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { OverviewBrief } from "@/types/coach-brief";

type BriefResponse = { success: boolean; data: OverviewBrief };

/**
 * Fetches the coach pre-session brief for a client. The GET is read-only — the
 * `last_viewed_at` anchor moves ONLY through `markSeen()` (POST …/seen), so the
 * coach decides when the activity feed clears rather than having it wiped by a
 * page load. `revalidateOnFocus: false` keeps a tab focus from re-querying a
 * payload that only changes when the client acts.
 */
export function useOverviewBrief(clientId: string) {
  const { data, error, isLoading, mutate } = useSWR<BriefResponse>(
    clientId ? `/api/clients/${clientId}/overview-brief` : null,
    swrFetcher,
    { revalidateOnFocus: false, errorRetryCount: 3, errorRetryInterval: 1000 }
  );

  const [isMarkingSeen, setIsMarkingSeen] = useState(false);

  const markSeen = useCallback(async () => {
    if (!clientId) return;
    setIsMarkingSeen(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/overview-brief/seen`, {
        method: "POST",
      });
      const body = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !body.success) {
        throw new Error(body.error || "Failed to record view");
      }
      await mutate();
    } finally {
      setIsMarkingSeen(false);
    }
  }, [clientId, mutate]);

  return {
    brief: data?.data ?? null,
    isLoading,
    isError: !!error,
    mutate,
    markSeen,
    isMarkingSeen,
  };
}
