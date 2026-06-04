import { useEffect } from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import type {
  CheckIn,
  CheckInStatus,
  GetCheckInsResponse,
  Client,
  GetOverdueClientsResponse,
  GetClientsDueSoonResponse,
  GetClientRemindersResponse,
} from "@/types/check-in";
import { swrFetcher } from "@/lib/swr-fetcher";
import { CLIENT_CHECKINS_PAGE_SIZE } from "@/lib/constants";

const fetcher = swrFetcher;

// Shared SWRInfinite key builder for the offset-paginated coach check-ins reads
// (the "Load older" tab and the Metrics full-history fetch).
const buildCheckInsPageKey =
  (clientId: string) =>
  (pageIndex: number, previousPageData: GetCheckInsResponse | null) => {
    if (!clientId) return null;
    // Stop once a page comes back empty.
    if (previousPageData && previousPageData.checkIns.length === 0) return null;
    const offset = pageIndex * CLIENT_CHECKINS_PAGE_SIZE;
    return `/api/clients/${clientId}/check-ins?limit=${CLIENT_CHECKINS_PAGE_SIZE}&offset=${offset}`;
  };

// Hook to fetch check-ins for a client
export const useCheckInData = (
  clientId: string,
  options?: {
    limit?: number;
    offset?: number;
    status?: CheckInStatus;
    includeDailyLogCounts?: boolean;
  }
) => {
  const params = new URLSearchParams();
  if (options?.limit) params.append("limit", options.limit.toString());
  if (options?.offset) params.append("offset", options.offset.toString());
  if (options?.status) params.append("status", options.status);
  if (options?.includeDailyLogCounts) params.append("includeDailyLogCounts", "true");

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

// Hook for the coach per-client check-ins tab: offset-paginated "Load older"
// over the full history (no row cap). Pages accumulate into one flat list.
export const useClientCheckInsInfinite = (clientId: string) => {
  const { data, error, size, setSize, isLoading, mutate } =
    useSWRInfinite<GetCheckInsResponse>(buildCheckInsPageKey(clientId), fetcher, {
      revalidateOnFocus: false,
      revalidateFirstPage: false,
    });

  const checkIns = data ? data.flatMap((page) => page.checkIns) : [];
  const total = data?.[0]?.total ?? 0;
  const hasMore = checkIns.length < total;
  // The last requested page has not resolved yet.
  const isLoadingMore = Boolean(
    size > 0 && data && typeof data[size - 1] === "undefined"
  );

  return {
    checkIns,
    total,
    hasMore,
    isLoading,
    isLoadingMore,
    isError: error,
    size,
    setSize,
    mutate,
  };
};

// Eagerly pages through a client's ENTIRE check-in history (offset/total
// contract) so trend charts aren't silently capped at the default page size.
export const useAllClientCheckIns = (clientId: string) => {
  const { data, error, size, setSize, isLoading } =
    useSWRInfinite<GetCheckInsResponse>(buildCheckInsPageKey(clientId), fetcher, {
      revalidateOnFocus: false,
      revalidateFirstPage: false,
    });

  const checkIns = data ? data.flatMap((page) => page.checkIns) : [];
  const total = data?.[0]?.total ?? 0;
  const lastPageLoaded = !data || typeof data[size - 1] !== "undefined";
  const hasMore = Boolean(data) && checkIns.length < total;

  // Auto-advance until the full history is loaded.
  useEffect(() => {
    if (hasMore && lastPageLoaded) {
      void setSize((s) => s + 1);
    }
  }, [hasMore, lastPageLoaded, setSize]);

  return {
    checkIns,
    total,
    // Don't report "loading" once a page errors — otherwise hasMore stays true
    // forever (the failed page never loads) and the consumer is stuck on a
    // spinner instead of reaching its error state.
    isLoading: !error && (isLoading || hasMore),
    isError: error,
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

// Hook to fetch a single client
export const useClient = (clientId: string) => {
  const { data, error, isLoading, mutate } = useSWR<{ client: Client }>(
    clientId ? `/api/clients/${clientId}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
    }
  );

  return {
    client: data?.client,
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

// Hook to fetch overdue clients
export const useOverdueClients = () => {
  const { data, error, isLoading, mutate } = useSWR<GetOverdueClientsResponse>(
    "/api/clients/overdue",
    fetcher,
    {
      refreshInterval: 60000, // Refresh every minute
      revalidateOnFocus: true,
    }
  );

  return {
    clients: data?.clients || [],
    total: data?.total || 0,
    isLoading,
    isError: error,
    mutate,
  };
};

// Hook to fetch clients due soon
export const useClientsDueSoon = () => {
  const { data, error, isLoading, mutate } = useSWR<GetClientsDueSoonResponse>(
    "/api/clients/due-soon",
    fetcher,
    {
      refreshInterval: 60000, // Refresh every minute
      revalidateOnFocus: true,
    }
  );

  return {
    clients: data?.clients || [],
    total: data?.total || 0,
    isLoading,
    isError: error,
    mutate,
  };
};

// Hook to fetch reminder history for a client
export const useClientReminders = (clientId: string) => {
  const { data, error, isLoading, mutate } = useSWR<GetClientRemindersResponse>(
    clientId ? `/api/clients/${clientId}/reminders` : null,
    fetcher,
    {
      revalidateOnFocus: false,
    }
  );

  return {
    reminders: data?.reminders || [],
    total: data?.total || 0,
    isLoading,
    isError: error,
    mutate,
  };
};

// Hook to fetch all unreviewed check-ins across all clients
export const useUnreviewedCheckIns = () => {
  const { data, error, isLoading, mutate } = useSWR<GetCheckInsResponse>(
    "/api/check-ins/unreviewed",
    fetcher,
    {
      refreshInterval: 30000, // Refresh every 30 seconds
      revalidateOnFocus: true,
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
