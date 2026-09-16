"use client";

import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import { parseGetPlanResponse } from "@/lib/validations/training";

type UseTrainingPlanProps = {
  clientId: string;
};

/** The GET's body, as its validator parses it. */
type GetPlanApiResponse = NonNullable<ReturnType<typeof parseGetPlanResponse>>;

/** The Training tab's plan read. The key sits inside the training area
 *  (`/api/clients/{id}/training`), so `useInvalidateTrainingData`
 *  (hooks/use-calendar-events.ts) reaches it: every calendar write revalidates
 *  it in place. Never build this key elsewhere. */
export function trainingPlanKey(clientId: string): string {
  return `/api/clients/${clientId}/training`;
}

async function fetchTrainingPlan(url: string): Promise<GetPlanApiResponse> {
  const data = parseGetPlanResponse(await swrFetcher(url));
  if (!data) throw new Error("Invalid response from server");
  return data;
}

/** The server's own sentence when it sent one, else the error's. */
function loadErrorMessage(error: unknown): string {
  const info = (error as { info?: { error?: unknown } } | null)?.info;
  if (typeof info?.error === "string") return info.error;
  return error instanceof Error ? error.message : "Failed to load training plan";
}

/**
 * Reads a client's active training plan for the coach-side Training tab.
 *
 * Read-only: authoring lives in the Programs builder (`ProgramDraftProvider`),
 * and a plan reaches a client's calendar through placement, not through here.
 * `isPending` is "no answer yet" — the first load, or a cleared entry
 * refetching — and every surface reading the plan renders its frame with the
 * values pending rather than claiming a plan or its absence. A revalidation
 * keeps the answer in hand, so a refresh never flashes.
 */
export function useTrainingPlan({ clientId }: UseTrainingPlanProps) {
  const { data, error, mutate } = useSWR<GetPlanApiResponse>(
    trainingPlanKey(clientId),
    fetchTrainingPlan,
    {
      revalidateOnFocus: false,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
      onError: (err) => console.error("Failed to fetch training plan:", err),
    },
  );
  // A wrapper, not the bound `mutate` itself: handed to a click or a callback,
  // `mutate` would take that argument as the cache's new data.
  const refresh = useCallback(() => mutate(), [mutate]);

  return {
    clientId,
    plan: data?.plan ?? null,
    // The program that starts after `plan`, whether `plan` is running or queued.
    nextPlan: data?.nextPlan ?? null,
    // The client's today and the first day a program may start (the deletion
    // floor): a program starting before the floor has started. Together with a
    // program's own start they tell the hero a running program from one that
    // hasn't begun — without them it reported both alike, which is how a
    // retired future plan once passed for the current one.
    clientToday: data?.clientToday ?? null,
    planStartFloor: data?.planStartFloor ?? null,
    clientTimezone: data?.clientTimezone,
    isPending: data === undefined,
    // Only while there is no answer to show: a failed revalidation keeps the
    // plan on screen.
    loadError: data === undefined && error ? loadErrorMessage(error) : null,
    refresh,
  };
}

/**
 * Drops the plan read and refetches it. A write that changes which plan the
 * tab describes — an apply, a delete — calls this, because the hero renders a
 * definite answer and a revalidation would serve the stale one for the whole
 * refetch (CONVENTIONS §7).
 */
export function useClearTrainingPlan() {
  const { mutate } = useSWRConfig();
  return useCallback(
    (clientId: string) =>
      mutate(trainingPlanKey(clientId), undefined, { revalidate: true }),
    [mutate],
  );
}
