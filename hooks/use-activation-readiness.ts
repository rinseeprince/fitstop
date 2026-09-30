"use client";

import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { Readiness } from "@/lib/activation-readiness-items";

// Key construction, the read and clearing are co-located (the
// use-calendar-events.ts pattern): the activation card and the intake panel
// read the readiness through `useActivationReadiness`, and never build its
// key themselves.

/** The key of `GET /api/clients/[id]/activation-readiness`: what the activation card counts. */
export function activationReadinessKey(clientId: string): string {
  return `/api/clients/${clientId}/activation-readiness`;
}

const SWR_CONFIG = {
  revalidateOnFocus: false,
  errorRetryCount: 3,
  errorRetryInterval: 1000,
  onError: (error: unknown) => console.error("Failed to load activation readiness:", error),
} as const;

/**
 * A client's activation readiness — each plan in place or not — read only
 * while `enabled`: the activation card for a client in setup, the intake
 * panel while it is open. `refresh` reads it again.
 */
export function useActivationReadiness(clientId: string, enabled: boolean) {
  const { data, error, isLoading, mutate } = useSWR<{ success: boolean; data: Readiness }>(
    enabled && clientId ? activationReadinessKey(clientId) : null,
    swrFetcher,
    SWR_CONFIG
  );
  const refresh = useCallback(() => void mutate(), [mutate]);
  return { readiness: data?.data ?? null, error, isLoading, refresh };
}

/**
 * Drop a client's cached activation readiness, then let it refetch.
 *
 * CLEARED, not merely revalidated (CONVENTIONS §7): the card renders a
 * definite answer per item — "Daily habits" set up or not — and SWR would
 * serve the stale one for the whole refetch. Called by every habit writer on
 * success.
 */
export function useClearActivationReadiness() {
  const { mutate } = useSWRConfig();
  return useCallback(
    (clientId: string) => mutate(activationReadinessKey(clientId), undefined, { revalidate: true }),
    [mutate]
  );
}
