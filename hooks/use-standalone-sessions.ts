"use client";

import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { SavedSession } from "@/types/training";

type StandaloneSessionsResponse = {
  success: boolean;
  sessions: SavedSession[];
};

export function useStandaloneSessions() {
  const { data, error, isLoading, mutate } = useSWR<StandaloneSessionsResponse>(
    "/api/training/saved-sessions",
    swrFetcher,
    {
      revalidateOnFocus: false,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
    }
  );

  return {
    sessions: data?.sessions ?? [],
    isLoading,
    error,
    mutate,
  };
}
