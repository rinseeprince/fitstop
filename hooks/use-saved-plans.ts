"use client";

import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { SavedPlan } from "@/types/training";

type SavedPlansResponse = {
  success: boolean;
  plans: SavedPlan[];
};

// includeDrafts keys SWR on ?status=all so the Programs table (which shows
// drafts) and the calendar library panel (which must not) never share a
// cache entry.
export function useSavedPlans(options?: { includeDrafts?: boolean }) {
  const key = options?.includeDrafts
    ? "/api/training/saved-plans?status=all"
    : "/api/training/saved-plans";
  const { data, error, isLoading, mutate } = useSWR<SavedPlansResponse>(
    key,
    swrFetcher,
    {
      revalidateOnFocus: false,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
    }
  );

  return {
    plans: data?.plans ?? [],
    isLoading,
    error,
    mutate,
  };
}
