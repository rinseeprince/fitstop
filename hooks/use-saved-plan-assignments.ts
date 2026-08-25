"use client";

import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";

type SavedPlanAssignments = {
  perPlan: Array<{ savedPlanId: string; count: number }>;
  totalAssignments: number;
  distinctClients: number;
};

type AssignmentsResponse = {
  success: boolean;
  assignments: SavedPlanAssignments;
};

// Live client-assignment counts per saved plan — feeds the Programs page
// stat band ("Active assignments · across N clients").
export function useSavedPlanAssignments() {
  const { data, error, isLoading } = useSWR<AssignmentsResponse>(
    "/api/training/saved-plans/assignments",
    swrFetcher,
    {
      revalidateOnFocus: false,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
    }
  );

  return {
    assignments: data?.assignments ?? null,
    isLoading,
    error,
  };
}
