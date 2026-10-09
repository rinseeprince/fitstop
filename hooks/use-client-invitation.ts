"use client";

import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { InvitationRead } from "@/types/auth";

// Key construction, the read and clearing are co-located (the
// use-calendar-events.ts pattern): the Invite box reads a client's invitation
// through `useClientInvitation`, and nothing builds its key elsewhere.

/** The key of `GET /api/clients/[id]/invitation`: what the Invite box says. */
export function clientInvitationKey(clientId: string): string {
  return `/api/clients/${clientId}/invitation`;
}

const SWR_CONFIG = {
  revalidateOnFocus: false,
  errorRetryCount: 3,
  errorRetryInterval: 1000,
  onError: (error: unknown) => console.error("Failed to load the invitation:", error),
} as const;

/**
 * A client's invitation as the Invite box shows it, read once `enabled` (the
 * box's first open, and held through its closes so a closing card keeps what
 * it showed): pending until the read lands (`invitation` null, not `failed`),
 * or failed. `retry` reads it again, `retrying` while it does.
 */
export function useClientInvitation(clientId: string, enabled: boolean) {
  const { data, error, isValidating, mutate } = useSWR<{ success: boolean; data: InvitationRead }>(
    enabled && clientId ? clientInvitationKey(clientId) : null,
    swrFetcher,
    SWR_CONFIG
  );
  const retry = useCallback(() => void mutate(), [mutate]);
  return { invitation: data?.data ?? null, failed: Boolean(error) && !data, retrying: isValidating, retry };
}

/**
 * Drop a client's cached invitation, then let it refetch.
 *
 * CLEARED, not merely revalidated (CONVENTIONS §7): the box renders a definite
 * answer — "Not invited yet.", a link that "works until 15 Oct" — and SWR
 * would serve the stale one for the whole refetch. The box clears it as it
 * opens, and activation, which can send an invitation, clears it on success.
 */
export function useClearClientInvitation() {
  const { mutate } = useSWRConfig();
  return useCallback(
    (clientId: string) => mutate(clientInvitationKey(clientId), undefined, { revalidate: true }),
    [mutate]
  );
}
