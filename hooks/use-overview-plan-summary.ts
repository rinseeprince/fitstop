"use client";

import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { OverviewPlanSummary } from "@/types/coach-overview";

type PlanSummaryResponse = { success: boolean; data: OverviewPlanSummary };

/**
 * Date-resolved training + nutrition plan metadata for the Overview's CURRENT
 * PLAN cards. Both halves are independently nullable — a client can be on a
 * training plan with no nutrition plan, or the reverse.
 */
export function useOverviewPlanSummary(clientId: string) {
  const { data, error, isLoading } = useSWR<PlanSummaryResponse>(
    clientId ? `/api/clients/${clientId}/overview-plan-summary` : null,
    swrFetcher,
    { revalidateOnFocus: false, errorRetryCount: 3, errorRetryInterval: 1000 }
  );

  return { summary: data?.data ?? null, isLoading, isError: !!error };
}
