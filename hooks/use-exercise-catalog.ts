"use client";

import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { Exercise } from "@/types/training";

type ExercisesResponse = {
  success: boolean;
  exercises: Exercise[];
};

// The catalog read's cache key: a surface that adds to the catalog without
// reading it revalidates this key.
export const EXERCISE_CATALOG_KEY = "/api/training/exercises";

// Fetch-all catalog read (global + coach-specific) for the Exercises
// library — the catalog is small enough that all filtering happens
// client-side; ?search= stays the escape hatch for pickers.
export function useExerciseCatalog() {
  const { data, error, isLoading, mutate } = useSWR<ExercisesResponse>(
    EXERCISE_CATALOG_KEY,
    swrFetcher,
    {
      revalidateOnFocus: false,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
    }
  );

  return {
    exercises: data?.exercises ?? [],
    isLoading,
    error,
    mutate,
  };
}
