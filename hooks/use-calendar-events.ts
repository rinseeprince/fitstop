"use client";

import { useCallback, useMemo } from "react";
import useSWR, { useSWRConfig } from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { TrainingEvent } from "@/types/training";

type EventsResponse = {
  success: boolean;
  events: TrainingEvent[];
};

// Key construction and invalidation are deliberately co-located so they can
// never drift (mirrors use-nutrition-calendar-events.ts): never build a
// /training/events key anywhere else.
function trainingEventsKeyPrefix(clientId: string) {
  return `/api/clients/${clientId}/training/events?`;
}

/**
 * Invalidates every cached month window of a client's training calendar. The
 * ONE sanctioned way to refresh the events cache from outside this hook —
 * for success handlers that rewrite training_events without holding the
 * calendar's own bound `mutate` (e.g. Job 2's plan-amendment overlay).
 *
 * Plain no-data mutate: mounted windows revalidate in place (no loading
 * flash); unmounted cached windows refetch on next mount via revalidateIfStale.
 */
export function useInvalidateTrainingCalendar() {
  const { mutate } = useSWRConfig();
  return useCallback(
    (clientId: string) =>
      mutate(
        (key) =>
          typeof key === "string" &&
          key.startsWith(trainingEventsKeyPrefix(clientId))
      ),
    [mutate]
  );
}

/**
 * Fetches and memoizes calendar events for a client across a date range.
 * Returns events grouped by date for O(1) cell lookup. Includes events from
 * all plans (active, planned, archived) so historical months render correctly.
 */
export function useCalendarEvents(
  clientId: string | null,
  startDate: string | null,
  endDate: string | null
) {
  const key =
    clientId && startDate && endDate
      ? `${trainingEventsKeyPrefix(clientId)}startDate=${startDate}&endDate=${endDate}`
      : null;

  const { data, error, isLoading, mutate } = useSWR<EventsResponse>(key, swrFetcher, {
    revalidateOnFocus: false,
  });

  const events = useMemo(() => data?.events ?? [], [data]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, TrainingEvent[]>();
    for (const event of events) {
      const existing = map.get(event.date);
      if (existing) {
        existing.push(event);
      } else {
        map.set(event.date, [event]);
      }
    }
    return map;
  }, [events]);

  return { events, eventsByDate, isLoading, error, mutate };
}
