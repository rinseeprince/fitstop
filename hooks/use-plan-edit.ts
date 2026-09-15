"use client";

import { useEffect } from "react";
import useSWR, { useSWRConfig } from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { PlanForEditing } from "@/services/plan-edit-service";

type PlanEditResponse = { success: boolean; data: PlanForEditing };

/** The plan editor's read — inside the training area, so
 *  `useInvalidateTrainingData` reaches it. Never build this key elsewhere. */
export function planEditKey(clientId: string, planId: string): string {
  return `/api/clients/${clientId}/training/${planId}/edit`;
}

/**
 * The plan as the editor opens it: laid from the calendar, with the version
 * its save is checked against. Key nulled unless both ids are present, so the
 * editor's source can compose it unconditionally.
 */
export function usePlanEdit(clientId: string | null, planId: string | null) {
  const key = clientId && planId ? planEditKey(clientId, planId) : null;
  const { mutate: mutateKey } = useSWRConfig();
  const { data, error, isLoading, mutate } = useSWR<PlanEditResponse>(key, swrFetcher, {
    revalidateOnFocus: false,
    errorRetryCount: 3,
    errorRetryInterval: 1000,
    onError: (err) => console.error("Failed to read the plan for editing:", err),
  });

  // Fresh per open: the editor seeds once from what it reads, so the entry is
  // dropped when the editor closes and the next open reads the calendar as it
  // is then. The drop REVALIDATES, because a cleanup is not always a close:
  // React's StrictMode runs it on every mount in development, and a coach can
  // close and reopen before the first read lands. Clearing makes SWR discard
  // a response still in flight as older than it, so an editor still reading
  // fetches its own copy; with nothing reading, nothing is fetched.
  useEffect(() => {
    if (!key) return;
    return () => {
      void mutateKey(key, undefined, { revalidate: true });
    };
  }, [key, mutateKey]);

  return { planForEditing: data?.data ?? null, isLoading, error: error as unknown, mutate };
}
