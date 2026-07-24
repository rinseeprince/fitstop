import useSWR from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";

type HistoryResponse<T> = {
  rows: T[];
  total: number;
  [key: string]: unknown;
};

export const HISTORY_PAGE_SIZE = 10;

export function useHistoryData<T>(
  url: string | null,
  page: number,
  pageSize: number = HISTORY_PAGE_SIZE
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
      // Page flips change the SWR key; without this, total collapses to 0 and
      // the divider-hosted pager would blink out on every flip.
      keepPreviousData: true,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
      onError: (err) => console.error("[useHistoryData]", url, err),
    }
  );

  return {
    // On error, suppress keepPreviousData's laggy fallback — otherwise a
    // failed page flip silently presents the previous page's rows as the
    // requested page. Blank-on-error is the pre-keepPreviousData failure
    // behavior; the retry backoff recovers transient failures.
    rows: error ? [] : data?.rows || [],
    total: error ? 0 : data?.total || 0,
    extra: data || {},
    isLoading,
    isError: error,
    mutate,
  };
}
