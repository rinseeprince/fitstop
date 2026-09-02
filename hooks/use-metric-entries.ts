import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { GetMetricEntriesResponse } from "@/types/metric-entries";

// Coach-logged WELLNESS entries for a client (client_metric_entries). The
// Journey's Wellness pane merges these with the check-ins' weekly averages
// client-side; a physique reading is a row in the measurement log instead.
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
