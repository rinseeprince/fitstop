"use client";

import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import type { AttentionFeedResponse } from "@/types/attention-feed";

// Key construction and invalidation are deliberately co-located (the
// use-calendar-events.ts pattern): never build the feed's key anywhere else.
const ATTENTION_FEED_KEY = "/api/dashboard/attention-feed";

const fetcher = async (url: string) => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to fetch attention feed");
  }
  const data: AttentionFeedResponse = await response.json();
  return data.data;
};

/** The coach dashboard's Needs Attention feed — every client with alerts. */
export function useAttentionFeed() {
  return useSWR(ATTENTION_FEED_KEY, fetcher, {
    revalidateOnFocus: false,
    errorRetryCount: 3,
    errorRetryInterval: 1000,
    dedupingInterval: 2000,
    onError: (error) => {
      console.error("Failed to fetch attention feed:", error);
    },
  });
}

/**
 * Drop the cached feed, then let it refetch.
 *
 * CLEARED, not merely revalidated (CONVENTIONS §7): the feed renders a
 * definite answer per client — "No nutrition targets from 16 Feb", or "All
 * clients on track" — and the plan writers on a client page change what it
 * says. The dashboard is not mounted while they run, so the next visit would
 * otherwise open on the stale claim for the length of the refetch. Called
 * beside `useClearClientOverview` from every calendar writer's success path.
 */
export function useClearAttentionFeed() {
  const { mutate } = useSWRConfig();
  return useCallback(
    () => mutate(ATTENTION_FEED_KEY, undefined, { revalidate: true }),
    [mutate]
  );
}
