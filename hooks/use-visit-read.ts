"use client";

import { useEffect, useState } from "react";
import useSWR, {
  unstable_serialize,
  useSWRConfig,
  type SWRConfiguration,
  type SWRResponse,
} from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";

type VisitKey = readonly [url: string, visit: string];

/**
 * The record an edit screen fills its form from, loaded fresh for this visit.
 *
 * A form that fills once — logging a workout, wellness, nutrition — fills from
 * data loaded after its screen opened, never from a copy an earlier visit left
 * in the cache (CONVENTIONS §7). The record changes without that screen's own
 * save: the check-in's training checklist logs workouts, the coach changes a
 * workout, the client logs on another device.
 *
 * The key carries an id made when the screen mounts, so every visit starts with
 * no cached copy and no finished request to share: SWR's dedupe window cannot
 * hand a reopened screen what the last visit loaded. Until this visit's load
 * lands, `data` and `error` are both undefined.
 *
 * No other screen can reach a visit's key, so a visit read has no invalidator
 * and a save leaves it alone. Its entry goes when the screen unmounts.
 */
export function useVisitRead<Data>(
  url: string | null,
  config?: SWRConfiguration<Data>,
): SWRResponse<Data> {
  const [visit] = useState(() => crypto.randomUUID());
  const key: VisitKey | null = url === null ? null : [url, visit];
  const cacheKey = key === null ? null : unstable_serialize(key);
  const { cache } = useSWRConfig();

  useEffect(() => {
    if (cacheKey === null) return;
    return () => {
      cache.delete(cacheKey);
    };
  }, [cache, cacheKey]);

  return useSWR<Data, unknown, VisitKey | null>(key, fetchVisit, config);
}

function fetchVisit([url]: VisitKey) {
  return swrFetcher(url);
}
