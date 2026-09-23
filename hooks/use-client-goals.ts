"use client";

import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { ClientGoalsOverview, GoalHistoryRow, GoalOnDay } from "@/types/client-goals";

/**
 * A client's goals, the coach-side read path: the goal in force on the
 * client's today — with the client's readings on its start day — and the
 * goals planned after it (`GET …/goals`), and the Journey's goals table, every
 * goal with what happened during it (`GET …/goals/history`).
 *
 * Goals come back as stored, not resolved: an editor seeds its fields from the
 * targets the coach set, and a consumer that needs the calculator's view runs
 * `resolveEffectiveGoal` itself. Consumers resolve; this module fetches.
 */

const SWR_OPTS = {
  revalidateOnFocus: false,
  errorRetryCount: 3,
  errorRetryInterval: 1000,
};

/**
 * The goals API AREA for this client, not one endpoint (CONVENTIONS §7): today's
 * goal and the goals table are two reads under it, and a goal write changes
 * both, so the invalidator matches on this prefix and covers both by
 * construction.
 */
const clientGoalsKey = (clientId: string) => `/api/clients/${clientId}/goals`;

const clientGoalHistoryKey = (clientId: string) => `${clientGoalsKey(clientId)}/history`;

// Stable empties, so a consumer that memoises on a list is not re-run by every
// render before the read lands.
const NO_PLANNED: GoalOnDay[] = [];
const NO_HISTORY: GoalHistoryRow[] = [];

export function useClientGoals(clientId: string) {
  const { data, error, isLoading, mutate } = useSWR<{ success: boolean; data: ClientGoalsOverview }>(
    clientId ? clientGoalsKey(clientId) : null,
    swrFetcher,
    SWR_OPTS
  );

  return {
    current: data?.data.current ?? null,
    planned: data?.data.planned ?? NO_PLANNED,
    clientToday: data?.data.clientToday ?? null,
    isLoading,
    // Failed only with nothing to show: a refetch that fails over goals
    // already read — or seeded by a write — leaves them on screen.
    isError: !!error && !data,
    retry: () => void mutate(),
  };
}

/** The Journey's goals table: every goal, planned first, with what happened during it. */
export function useClientGoalHistory(clientId: string) {
  const { data, error, isLoading, mutate } = useSWR<{ success: boolean; data: GoalHistoryRow[] }>(
    clientId ? clientGoalHistoryKey(clientId) : null,
    swrFetcher,
    SWR_OPTS
  );

  return {
    goals: data?.data ?? NO_HISTORY,
    isLoading,
    // Failed only with nothing to show, as the goals read.
    isError: !!error && !data,
    retry: () => void mutate(),
  };
}

/**
 * Refetches the goals table where it is on screen, keeping its rows until the
 * new ones land — for a write made from the table itself, which closes once it
 * has. Rejects when the refetch fails, the rows on screen left as they were.
 */
export function useRefreshClientGoalHistory() {
  const { mutate } = useSWRConfig();
  return useCallback(
    async (clientId: string) => {
      const key = clientGoalHistoryKey(clientId);
      await mutate(key, swrFetcher(key), { revalidate: false });
    },
    [mutate]
  );
}

/**
 * Writes a goal write's OWN response — every goal route answers with the goals
 * as they now stand — into the goals read, with no refetch. The caller closes
 * its surface in the same tick, so the two land in one render and no frame
 * shows the goal it just changed (CONVENTIONS §7, `useSeedClientBlocks`).
 */
export function useSeedClientGoals() {
  const { mutate } = useSWRConfig();
  return useCallback(
    (clientId: string, overview: ClientGoalsOverview) =>
      mutate(clientGoalsKey(clientId), { success: true, data: overview }, { revalidate: false }),
    [mutate]
  );
}

/**
 * Revalidates every reader of a client's goals, from anywhere — today's goal
 * and the goals table alike. It covers the goals area only: a caller with other
 * client-derived data on screen refreshes that itself.
 */
export function useInvalidateClientGoals() {
  const { mutate } = useSWRConfig();
  return useCallback(
    (clientId: string) =>
      mutate((key) => typeof key === "string" && key.startsWith(clientGoalsKey(clientId))),
    [mutate]
  );
}

/**
 * Drops a client's cached goals table, refetching it if mounted — for a write
 * made where the table is not on screen: a goal write, which lands its own
 * answer in the goals read (`useSeedClientGoals`), and every write of what the
 * table lists beside the goals — a program's window, a nutrition version. The
 * table's next open starts from its loading state, never on the rows the write
 * changed.
 */
export function useClearClientGoalHistory() {
  const { mutate } = useSWRConfig();
  return useCallback(
    (clientId: string) => mutate(clientGoalHistoryKey(clientId), undefined, { revalidate: true }),
    [mutate]
  );
}

/**
 * Drops every cached read of a client's goals, refetching whichever is
 * mounted — for a write no goals reader on screen shows: the next one to open
 * starts from its loading state, never on the start reading the write moved
 * (CONVENTIONS §7, a read that renders a definite answer is cleared).
 */
export function useClearClientGoals() {
  const { mutate } = useSWRConfig();
  return useCallback(
    (clientId: string) =>
      mutate(
        (key) => typeof key === "string" && key.startsWith(clientGoalsKey(clientId)),
        undefined,
        { revalidate: true }
      ),
    [mutate]
  );
}
