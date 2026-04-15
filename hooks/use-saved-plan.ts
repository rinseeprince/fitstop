"use client";

import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { SavedPlan } from "@/types/training";

type SavedPlanResponse = {
  success: boolean;
  plan: SavedPlan;
};

export function useSavedPlan(savedPlanId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<SavedPlanResponse>(
    savedPlanId ? `/api/training/saved-plans/${savedPlanId}` : null,
    swrFetcher,
    {
      revalidateOnFocus: false,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
    }
  );

  return {
    plan: data?.plan ?? null,
    isLoading,
    error,
    mutate,
  };
}
