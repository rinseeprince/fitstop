"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";

export type ExerciseUsage = {
  perExercise: Array<{ exerciseId: string; sessionCount: number }>;
  sessionsWithLinks: number;
};

type UsageResponse = {
  success: boolean;
  usage: ExerciseUsage;
};

// Distinct-session usage per catalog exercise — feeds the Exercises page
// "Used in" column + "In use" stat cell.
export function useExerciseUsage() {
  const { data, error, isLoading } = useSWR<UsageResponse>(
    "/api/training/exercises/usage",
    swrFetcher,
    {
      revalidateOnFocus: false,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
    }
  );

  const usageByExercise = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of data?.usage.perExercise ?? []) {
      map.set(entry.exerciseId, entry.sessionCount);
    }
    return map;
  }, [data]);

  return {
    usage: data?.usage ?? null,
    usageByExercise,
    isLoading,
    error,
  };
}
