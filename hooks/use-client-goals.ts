"use client";

import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { ClientGoal } from "@/types/client-goals";

type GoalsResponse = { success: boolean; data: ClientGoal | null };

/**
 * The client's live `client_goals` record — the coach-side goal read path
 * (invariant 16: one writer, one read path).
 *
 * Returns the RAW goal rather than a resolved one. `resolveEffectiveGoal`
 * coalesces `goalStartDate` to today, which is right for a consumer asking
 * "what drives this client now?" and wrong for an editor seeding a form: it
 * would write today's date into a field the coach never set. Consumers resolve;
 * this hook fetches.
 */

const SWR_OPTS = {
  revalidateOnFocus: false,
  errorRetryCount: 3,
  errorRetryInterval: 1000,
};

/**
 * The goals API AREA for this client, not one endpoint (CONVENTIONS §7). The
 * `?history=true` variant of the same GET returns a different `data` shape, so
 * it is a separate cache entry that a writer must invalidate too — matching on
 * the prefix covers it by construction.
 */
export const clientGoalsKeyPrefix = (clientId: string) =>
  `/api/clients/${clientId}/goals`;

export function useClientGoals(clientId: string) {
  const { data, error, isLoading } = useSWR<GoalsResponse>(
    clientId ? clientGoalsKeyPrefix(clientId) : null,
    swrFetcher,
    SWR_OPTS
  );

  return { goal: data?.data ?? null, isLoading, isError: !!error };
}

/**
 * Revalidates every reader of a client's goals, from anywhere. A goal write also
 * dual-writes the `clients` mirror, so a caller that has other client-derived
 * data on screen must refresh that too — this covers the goals area only.
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
