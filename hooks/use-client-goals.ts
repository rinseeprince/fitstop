"use client";

import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { ClientGoal } from "@/types/client-goals";

type GoalsResponse = { success: boolean; data: ClientGoal | null };

// Key construction and invalidation are co-located so they can never drift
// (CONVENTIONS §7): never build a /goals key anywhere else.
function clientGoalsKeyPrefix(clientId: string) {
  return `/api/clients/${clientId}/goals`;
}

/**
 * Invalidates a client's goal reads. MUST be called from any success handler
 * that writes `client_goals` — the Overview's goal chips and the Metrics page
 * both read this area, and SWR's per-component `mutate` reaches neither.
 *
 * Matches the whole area by prefix, not the bare key, so a later reader that
 * adds `?history=true` is covered without touching this.
 */
export function useInvalidateClientGoals() {
  const { mutate } = useSWRConfig();
  return useCallback(
    (clientId: string) =>
      mutate(
        (key) =>
          typeof key === "string" && key.startsWith(clientGoalsKeyPrefix(clientId))
      ),
    [mutate]
  );
}

/**
 * The client's live (non-superseded) goal record from `client_goals`.
 *
 * This is the real goal store. The `clients.goal_weight` /
 * `goal_body_fat_percentage` columns are a denormalized mirror kept in sync by a
 * non-blocking, error-swallowed dual-write, so the two can silently diverge —
 * read this, not the mirror. (`clients.goal_deadline` is worse than stale: it is
 * never mapped by `mapClientRow` at all, so `client.goalDeadline` is always
 * undefined.)
 *
 * Returns the raw record in the client's DISPLAY units. Callers that need kg go
 * through `resolveEffectiveGoal`, which owns that normalization.
 */
export function useClientGoals(clientId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<GoalsResponse>(
    clientId ? clientGoalsKeyPrefix(clientId) : null,
    swrFetcher,
    {
      revalidateOnFocus: false,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
    }
  );

  return { goal: data?.data ?? null, isLoading, error, mutate };
}
