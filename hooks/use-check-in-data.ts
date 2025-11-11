import useSWR from "swr";
import type { CheckIn, GetCheckInsResponse } from "@/types/check-in";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

// Hook to fetch check-ins for a client
export const useCheckInData = (
  clientId: string,
  options?: {
    limit?: number;
    offset?: number;
    status?: string;
  }
) => {
  const params = new URLSearchParams();
  if (options?.limit) params.append("limit", options.limit.toString());
  if (options?.offset) params.append("offset", options.offset.toString());
  if (options?.status) params.append("status", options.status);

  const url = `/api/clients/${clientId}/check-ins?${params.toString()}`;

  const { data, error, isLoading, mutate } = useSWR<GetCheckInsResponse>(
    clientId ? url : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );

  return {
    checkIns: data?.checkIns || [],
    total: data?.total || 0,
    isLoading,
    isError: error,
    mutate,
  };
};

// Hook to fetch a single check-in
export const useCheckIn = (checkInId: string) => {
  const { data, error, isLoading, mutate } = useSWR<CheckIn>(
    checkInId ? `/api/check-in/${checkInId}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
    }
  );

  return {
    checkIn: data,
    isLoading,
    isError: error,
    mutate,
  };
};

// Hook to get unreviewed check-ins count
export const useUnreviewedCount = (clientId?: string) => {
  const { data, error, isLoading, mutate } = useSWR<GetCheckInsResponse>(
    clientId
      ? `/api/clients/${clientId}/check-ins?status=ai_processed`
      : null,
    fetcher,
    {
      refreshInterval: 30000, // Refresh every 30 seconds
    }
  );

  return {
    count: data?.total || 0,
    isLoading,
    isError: error,
    mutate,
  };
};
