import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";

type HistoryResponse<T> = {
  rows: T[];
  total: number;
  [key: string]: unknown;
};

export function useHistoryData<T>(
  url: string | null,
  page: number,
  pageSize: number = 10
) {
  const fullUrl = url
    ? `${url}${url.includes("?") ? "&" : "?"}limit=${pageSize}&offset=${page * pageSize}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<HistoryResponse<T>>(
    fullUrl,
    swrFetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );

  return {
    rows: data?.rows || [],
    total: data?.total || 0,
    extra: data || {},
    isLoading,
    isError: error,
    mutate,
  };
}
