"use client";

import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { RecentExercise } from "@/services/exercise-catalog-service";

type RecentResponse = {
  success: boolean;
  recent: RecentExercise[];
};

// Most-recently-used exercises for the builder pickers' "Recently used"
// strip — derived server-side from coach_saved_exercises recency.
export function useRecentExercises() {
  const { data, error, isLoading } = useSWR<RecentResponse>(
    "/api/training/exercises/recent",
    swrFetcher,
    {
      revalidateOnFocus: false,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
    }
  );

  return {
    recent: data?.recent ?? [],
    isLoading,
    error,
  };
}
