"use client";

import useSWR from "swr";
import { useAuth } from "@/contexts/auth-context";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { Client } from "@/types/check-in";

type ClientMeResponse = { success: boolean; data: Client };

export function useClientProfile() {
  const { user } = useAuth();
  const { data, error, isLoading, mutate } = useSWR<ClientMeResponse>(
    user ? "/api/client/me" : null,
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
