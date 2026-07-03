"use client";

import { useEffect, useMemo } from "react";
import { useExerciseCatalog } from "@/hooks/use-exercise-catalog";
import { filterExercisesByQuery } from "@/lib/exercise-search";

// Minimum query length before pickers show matches — mirrors the old
// server-search threshold so a single character doesn't dump the catalog.
export const MIN_SEARCH_CHARS = 2;

// Instant picker search over the SWR-cached catalog (name + aliases) —
// one fetch per session, deduped with the Exercises library page. Every
// match is returned; display capping/scrolling is the caller's concern.
export function useExerciseSearch(query: string) {
  const { exercises, isLoading, error, mutate } = useExerciseCatalog();

  // A failed mount-time fetch would otherwise dead-end search for the whole
  // mount (SWR gives up after its retries, and filtering never re-fetches).
  // Retrying on type restores the old per-keystroke self-healing.
  useEffect(() => {
    if (error && query.trim().length >= MIN_SEARCH_CHARS) {
      void mutate();
    }
  }, [error, query, mutate]);

  const results = useMemo(() => {
    if (query.trim().length < MIN_SEARCH_CHARS) return [];
    return filterExercisesByQuery(exercises, query);
  }, [exercises, query]);

  return { results, isLoading, error };
}
