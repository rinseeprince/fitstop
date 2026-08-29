import { useCallback, useEffect } from "react";
import useSWR, { useSWRConfig } from "swr";
import useSWRInfinite from "swr/infinite";
import type {
  CheckIn,
  GetCheckInsResponse,
  Client,
  OverdueClient,
  GetOverdueClientsResponse,
  GetClientsDueSoonResponse,
} from "@/types/check-in";
import { swrFetcher } from "@/lib/swr-fetcher";
import { CLIENT_CHECKINS_PAGE_SIZE } from "@/lib/constants";

const fetcher = swrFetcher;

// Key construction and invalidation are co-located so they can never drift
// (CONVENTIONS §7): never build a per-client check-ins key anywhere else.
function clientCheckInsKeyPrefix(clientId: string) {
  return `/api/clients/${clientId}/check-ins`;
}

// Shared SWRInfinite key builder for the offset-paginated coach check-ins reads
// (the "Load older" tab and the Metrics full-history fetch).
const buildCheckInsPageKey =
  (clientId: string) =>
  (pageIndex: number, previousPageData: GetCheckInsResponse | null) => {
    if (!clientId) return null;
    // Stop once a page comes back empty.
    if (previousPageData && previousPageData.checkIns.length === 0) return null;
    const offset = pageIndex * CLIENT_CHECKINS_PAGE_SIZE;
    return `${clientCheckInsKeyPrefix(clientId)}?limit=${CLIENT_CHECKINS_PAGE_SIZE}&offset=${offset}`;
  };

/**
 * Invalidates every cached read of a client's check-in list from outside the
 * hook that read it — the ONE sanctioned way (CONVENTIONS §7).
 *
 * Two legs, because both readers are `useSWRInfinite` hooks and a
 * filter-function mutate cannot reach one of those: swr skips its `$inf$` key
 * outright, and the per-page keys it stores have no revalidator (verified in
 * swr 2.3.6). So:
 * 1. a plain revalidate over the area, for any mounted plain reader (none yet —
 *    an area-wide matcher is what keeps the next one covered);
 * 2. the per-page caches are CLEARED (data → undefined, no fetch), so the next
 *    mount of either infinite reader finds every page missing and refetches the
 *    whole list. Restricted to the page-key shape, because a data-less,
 *    revalidate-less mutate would blank a plain reader without refreshing it.
 *
 * A MOUNTED infinite reader still refreshes only through its own bound
 * `mutate()` — a success handler inside the tab calls both.
 */
export function useInvalidateClientCheckIns() {
  const { mutate } = useSWRConfig();
  return useCallback(
    (clientId: string) => {
      const prefix = clientCheckInsKeyPrefix(clientId);
      const inArea = (key: unknown): key is string =>
        typeof key === "string" && key.startsWith(prefix);
      return Promise.all([
        mutate(inArea),
        mutate((key) => inArea(key) && key.startsWith(`${prefix}?`), undefined, {
          revalidate: false,
        }),
      ]);
    },
    [mutate]
  );
}

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

// Hook to fetch overdue clients
// Stable empty array. `data?.clients || []` minted a fresh [] on every render
// while the fetch was unresolved, so every consumer memo keyed on `clients`
// recomputed each render — and stayed dead for good if the fetch kept failing.
const NO_OVERDUE_CLIENTS: OverdueClient[] = [];

export const useOverdueClients = () => {
  const { data, error, isLoading, mutate } = useSWR<GetOverdueClientsResponse>(
    "/api/clients/overdue",
    fetcher,
    {
      refreshInterval: 60000, // Refresh every minute
      // Deliberately true, against the §7 default. These badges' dominant writer
      // is the CLIENT submitting in another session, which no coach-side
      // invalidator can ever reach — and SWR suspends polling while the tab is
      // hidden, so focus revalidation is the only prompt refresh after an alt-tab.
      revalidateOnFocus: true,
      // NotificationsDropdown lives in app-layout.tsx, a plain component rendered
      // inside each page rather than a Next layout, so it remounts on every
      // navigation and re-fires once the default 2s dedupe lapses. 5s is the
      // repo's existing ceiling; it collapses the burst within one navigation
      // without blanking mount revalidation for a whole refresh cycle.
      dedupingInterval: 5000,
    }
  );

  return {
    clients: data?.clients ?? NO_OVERDUE_CLIENTS,
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
      revalidateOnFocus: true, // see useOverdueClients
      dedupingInterval: 5000, // see useOverdueClients
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

// The coach-wide check-in queue. The key stays narrow; only the area matcher
// below widens, to `/api/check-ins` — this queue plus the dashboard's
// `/api/check-ins/recent` list. (`/api/check-in/…`, singular, is the
// per-check-in detail area and does not match.)
export const checkInsQueueKey = "/api/check-ins/unreviewed";
const CHECK_INS_AREA_PREFIX = "/api/check-ins";

/**
 * Invalidates every cached read under /api/check-ins — the ONE sanctioned way
 * to refresh the queue from a success handler that does not hold this hook's
 * bound `mutate` (CONVENTIONS §7).
 */
export function useInvalidateCheckInsQueue() {
  const { mutate } = useSWRConfig();
  return useCallback(
    () =>
      mutate(
        (key) =>
          typeof key === "string" && key.startsWith(CHECK_INS_AREA_PREFIX)
      ),
    [mutate]
  );
}

// Stable empty array — see NO_OVERDUE_CLIENTS. The toast listener's effect is
// keyed on `checkIns`, so a fresh [] per unresolved render would re-run it.
const NO_UNREVIEWED_CHECK_INS: CheckIn[] = [];

// Hook to fetch all unreviewed check-ins across all clients
export const useUnreviewedCheckIns = () => {
  const { data, error, isLoading, mutate } = useSWR<GetCheckInsResponse>(
    checkInsQueueKey,
    fetcher,
    {
      refreshInterval: 30000, // Refresh every 30 seconds
      revalidateOnFocus: true, // see useOverdueClients
      dedupingInterval: 5000, // see useOverdueClients
      errorRetryCount: 3,
      errorRetryInterval: 1000,
      onError: (err) =>
        console.error("Failed to fetch unreviewed check-ins:", err),
    }
  );

  return {
    checkIns: data?.checkIns ?? NO_UNREVIEWED_CHECK_INS,
    total: data?.total || 0,
    isLoading,
    isError: error,
    mutate,
  };
};
