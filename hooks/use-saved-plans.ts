"use client";

import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { SavedPlan } from "@/types/training";

type SavedPlansResponse = {
  success: boolean;
  plans: SavedPlan[];
};

export function useSavedPlans() {
  const { data, error, isLoading, mutate } = useSWR<SavedPlansResponse>(
    "/api/training/saved-plans",
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
