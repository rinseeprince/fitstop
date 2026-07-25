import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { GetMetricEntriesResponse } from "@/types/metric-entries";

// Coach-logged measurement entries for a client (client_metric_entries).
// The Metrics page merges these with check-in-derived values client-side.
export const useMetricEntries = (clientId: string) => {
  const { data, error, isLoading, mutate } = useSWR<GetMetricEntriesResponse>(
    clientId ? `/api/clients/${clientId}/metric-entries` : null,
    swrFetcher,
    {
      revalidateOnFocus: false,
    }
  );

  return {
    entries: data?.data ?? [],
    isLoading,
    isError: error,
    mutate,
  };
};
