"use client";

import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { PlacedPlanForBuilder } from "@/services/plan-amendment-service";

type PlacedPlanResponse = PlacedPlanForBuilder & { success: boolean };

/**
 * The amendment GET — the full-fidelity placed plan + drift token the
 * amendment surface seeds from. Key nulled unless both ids are present, so the
 * provider can compose it unconditionally and the Plans-subtab entry point can
 * share the same cache entry (its isFullyPast gating reads never double-fetch
 * against an open editor).
 */
export function usePlacedPlan(clientId: string | null, planId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<PlacedPlanResponse>(
    clientId && planId
      ? `/api/clients/${clientId}/training/${planId}/amendment`
      : null,
    swrFetcher,
    {
      revalidateOnFocus: false,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
    },
  );

  return {
    placedPlan: data ?? null,
    isLoading,
    error,
    mutate,
  };
}
