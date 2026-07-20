"use client";

import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { SavedPlansSummary } from "@/types/training";

type SavedPlansSummaryResponse = {
  success: boolean;
  summary: SavedPlansSummary;
};

// Aggregate stats for the Programs stat band, decoupled from list pagination
// (its own endpoint, like assignments).
export function useSavedPlansSummary(includeDrafts = true) {
  const key = includeDrafts
    ? "/api/training/saved-plans/summary?status=all"
    : "/api/training/saved-plans/summary";
  const { data, isLoading, mutate } = useSWR<SavedPlansSummaryResponse>(
    key,
    swrFetcher,
    { revalidateOnFocus: false },
  );
  return { summary: data?.summary ?? null, isLoading, mutate };
}
