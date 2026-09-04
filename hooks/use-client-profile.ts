"use client";

import { useCallback } from "react";
import useSWR, { useSWRConfig } from "swr";
import { useAuth } from "@/contexts/auth-context";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { Client } from "@/types/check-in";

type ClientMeResponse = { success: boolean; data: Client };

/**
 * The client's own profile read. The key and its invalidator live together here
 * (CONVENTIONS §7) because the profile now carries the day-rule boundary
 * (`logsOpenFrom`): submitting a check-in closes that week, and nothing on the
 * check-in screen can reach this cache without an invalidator, so every page
 * that locks a day would keep the pre-submit boundary until a reload.
 */
export const CLIENT_PROFILE_KEY = "/api/client/me";

export function useClientProfile() {
  const { user } = useAuth();
  const { data, error, isLoading, mutate } = useSWR<ClientMeResponse>(
    user ? CLIENT_PROFILE_KEY : null,
    swrFetcher,
    {
      revalidateOnFocus: false,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
    },
  );

  return {
    client: data?.data ?? null,
    error,
    isLoading,
    mutate,
  };
}

/** Refetch the profile from anywhere — memoized, so it is safe in a dependency array. */
export function useInvalidateClientProfile() {
  const { mutate } = useSWRConfig();
  return useCallback(() => {
    void mutate(CLIENT_PROFILE_KEY);
  }, [mutate]);
}
