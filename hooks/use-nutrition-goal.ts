"use client";

import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { NutritionGoalForDay, NutritionOutOfDateRead } from "@/types/nutrition-goal";

/**
 * How nutrition follows the goal, the coach-side reads
 * (docs/MEASUREMENT-LOG-PLAN.md §6 commit 8d1): the goal and the calculator's
 * inputs for one day — the nutrition drawer's Starts on — and the out-of-date
 * rule's answer, which the Overview's nutrition card, the Nutrition tab and the
 * drawer all show.
 *
 * Both answers are derived from goals, readings, the profile's energy pair and
 * the saved versions, so every writer of any of those clears this area
 * (`useClearNutritionGoal`) — `use-nutrition-goal.test.ts` scans for the goal
 * and reading writers.
 */

const SWR_OPTS = {
  revalidateOnFocus: false,
  errorRetryCount: 3,
  errorRetryInterval: 1000,
};

/** The API AREA (CONVENTIONS §7): both reads live under it. */
const nutritionGoalArea = (clientId: string) => `/api/clients/${clientId}/nutrition/goal`;

export const nutritionGoalForDayKey = (clientId: string, day: string) =>
  `${nutritionGoalArea(clientId)}?date=${day}`;

export const nutritionOutOfDateKey = (clientId: string) =>
  `${nutritionGoalArea(clientId)}/out-of-date`;

/**
 * The goal in force on `day` and the calculator's inputs for it. A new day is
 * a new key, so it renders pending until it lands — never another day's
 * numbers — and a day already read answers from the cache at once. `day` null
 * reads nothing (the client's today is not known yet).
 */
export function useNutritionGoalForDay(clientId: string, day: string | null) {
  const { data, error, isLoading, mutate } = useSWR<{
    success: boolean;
    data: NutritionGoalForDay;
  }>(clientId && day ? nutritionGoalForDayKey(clientId, day) : null, swrFetcher, {
    ...SWR_OPTS,
    onError: (err) => console.error("Failed to read the goal for a nutrition day:", err),
  });

  return {
    goalForDay: data?.data ?? null,
    isLoading,
    isError: !!error,
    retry: () => void mutate(),
  };
}

/** The out-of-date rule's answer for the client. */
export function useNutritionOutOfDate(clientId: string) {
  const { data, error, isLoading } = useSWR<{ success: boolean; data: NutritionOutOfDateRead }>(
    clientId ? nutritionOutOfDateKey(clientId) : null,
    swrFetcher,
    {
      ...SWR_OPTS,
      onError: (err) => console.error("Failed to check nutrition against the goal:", err),
    }
  );

  return {
    outOfDate: data?.data.outOfDate ?? null,
    clientToday: data?.data.clientToday ?? null,
    isLoading,
    isError: !!error,
  };
}

/**
 * Drops every cached read of this area and refetches whichever is mounted.
 * CLEARED, not revalidated (CONVENTIONS §7): the notice and the drawer's Goal
 * line render definite answers — "The goal is now Build (84.6 kg by 14 Dec),
 * but the calories still aim for…", "No deadline, so calories are at
 * maintenance" — and a stale entry served through the refetch would state
 * something that has just stopped being true.
 */
export function useClearNutritionGoal() {
  const { mutate } = useSWRConfig();
  return useCallback(
    (clientId: string) => {
      const area = nutritionGoalArea(clientId);
      return mutate(
        (key) =>
          typeof key === "string" &&
          (key === area || key.startsWith(`${area}?`) || key.startsWith(`${area}/`)),
        undefined,
        { revalidate: true }
      );
    },
    [mutate]
  );
}
